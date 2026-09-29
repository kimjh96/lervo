import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { computeEventHash, eventWithoutHash } from "@lervo/event-contract";
import type { EventEnvelope } from "@lervo/schemas";
import type { EventStore } from "@lervo/storage-contract";
import { describe, expect, it } from "vitest";

import { collectExecutionEventSources } from "../src/execution-event-source.js";
import { collectExecutionEventSourcePages } from "../src/paged-execution-event-source.js";
import { defaultRepositoryKnowledgePolicy } from "../src/policy.js";
import { scanRepositoryKnowledge } from "../src/scanner.js";

const limits = { maxFiles: 100_000, maxTotalBytes: 64 * 1024 * 1024 };
const invalid = expect.objectContaining({ code: "knowledge_evidence_source_invalid" });

function history(count: number, documentBytes = 0): EventEnvelope[] {
  let previousHash: string | null = null;
  return Array.from({ length: count }, (_, index) => {
    const body: Omit<EventEnvelope, "eventHash"> = {
      eventId: `evt_page${String(index).padStart(8, "0")}`,
      projectId: "prj_pagefixture",
      runId: "run_pagefixture",
      sessionId: "ses_pagefixture",
      seq: index + 1,
      type: "context.selected",
      occurredAt: "2026-09-28T00:00:00.000Z",
      actor: { kind: "user" },
      schemaVersion: 1,
      policyVersion: `sha256:${"b".repeat(64)}`,
      payload: { documentId: "a".repeat(documentBytes) },
      previousHash,
    };
    const result = { ...body, eventHash: computeEventHash(body) };
    previousHash = result.eventHash;
    return result;
  });
}

function store(rows: EventEnvelope[]): Pick<EventStore, "latest" | "list" | "verifyIntegrity"> {
  return {
    latest: () => rows.at(-1) ?? null,
    list: (options) => rows.slice(options?.afterSeq ?? 0).slice(0, options?.limit),
    verifyIntegrity: () => ({
      valid: true,
      eventCount: rows.length,
      headHash: rows.at(-1)?.eventHash ?? null,
    }),
  };
}

describe("complete paged execution evidence", () => {
  it("preserves every original beyond the legacy byte bound with independently bounded pages", () => {
    const rows = history(4_100, 4_000);
    const events = store(rows);
    expect(() => collectExecutionEventSources({ events })).toThrowError(invalid);
    const pages = collectExecutionEventSourcePages({ events, limits });
    expect(pages).toHaveLength(2);
    expect(pages.flat().map((source) => JSON.parse(source.content))).toEqual(rows);
    for (const page of pages) {
      expect(page.length).toBeLessThanOrEqual(32_768);
      expect(
        page.reduce((sum, source) => sum + Buffer.byteLength(source.content), 0),
      ).toBeLessThanOrEqual(16 * 1024 * 1024);
    }
    expect(
      pages.flat().every((source) => source.adapter === "execution-event-v1+event-chain"),
    ).toBe(true);
    expect(events.latest()).toBe(rows.at(-1));
  });

  it("pages the source count without replacing event identities", () => {
    const rows = history(33_000);
    const pages = collectExecutionEventSourcePages({ events: store(rows), limits });
    expect(pages.flat()).toHaveLength(rows.length);
    expect(pages.every((page) => page.length <= 32_768)).toBe(true);
    expect(pages.flat().map((source) => source.path)).toEqual(
      rows.map((row) => `@event/${row.eventId}`),
    );
  });

  it("refuses a fifth page and both tracked aggregate bounds without partial output", () => {
    const rows = history(16_000, 4_000);
    expect(() =>
      collectExecutionEventSourcePages({
        events: store(rows),
        limits: {
          ...limits,
          maxTotalBytes: 128 * 1024 * 1024,
        },
      }),
    ).toThrowError(invalid);
    const small = store(history(2));
    expect(() =>
      collectExecutionEventSourcePages({ events: small, limits: { ...limits, maxFiles: 1 } }),
    ).toThrowError(invalid);
    expect(() =>
      collectExecutionEventSourcePages({ events: small, limits: { ...limits, maxTotalBytes: 1 } }),
    ).toThrowError(invalid);
  });

  it("pins its original head while allowing valid concurrent appends", () => {
    const rows = history(3);
    const events = store(rows);
    let appended = false;
    const pages = collectExecutionEventSourcePages({
      events: {
        ...events,
        list: (options) => {
          if (!appended) {
            rows.push(history(4)[3]!);
            appended = true;
          }
          return events.list(options);
        },
      },
      limits,
    });
    expect(pages.flat().map((source) => JSON.parse(source.content).seq)).toEqual([1, 2, 3]);
    expect(rows).toHaveLength(4);
  });

  it("rejects missing, duplicate, rehashed unsafe and tampered rows even with a lying integrity port", () => {
    for (const change of [
      (rows: EventEnvelope[]) => {
        rows.splice(1, 1);
      },
      (rows: EventEnvelope[]) => {
        rows[1]!.eventId = rows[0]!.eventId;
      },
      (rows: EventEnvelope[]) => {
        rows[0]!.payload.prompt = "private-paged-source";
      },
      (rows: EventEnvelope[]) => {
        rows[1]!.eventHash = `sha256:${"c".repeat(64)}`;
      },
    ]) {
      const rows = history(3);
      change(rows);
      if (rows[0]!.payload.prompt) {
        let previousHash: string | null = null;
        for (const row of rows) {
          row.previousHash = previousHash;
          row.eventHash = computeEventHash(eventWithoutHash(row));
          previousHash = row.eventHash;
        }
      }
      expect(() => collectExecutionEventSourcePages({ events: store(rows), limits })).toThrowError(
        invalid,
      );
      expect(() => collectExecutionEventSourcePages({ events: store(rows), limits })).not.toThrow(
        "private-paged-source",
      );
    }
  });

  it("checks the pinned anchor, sequence bound, final integrity and per-event bytes", () => {
    const rows = history(2);
    const events = store(rows);
    expect(() =>
      collectExecutionEventSourcePages({
        events: {
          ...events,
          latest: () => ({ ...rows[1]!, eventHash: `sha256:${"c".repeat(64)}` }),
        },
        limits,
      }),
    ).toThrowError(invalid);
    expect(() =>
      collectExecutionEventSourcePages({
        events: {
          ...events,
          latest: () => ({ ...rows[1]!, seq: 100_001 }),
        },
        limits,
      }),
    ).toThrowError(invalid);
    let checks = 0;
    expect(() =>
      collectExecutionEventSourcePages({
        events: {
          ...events,
          verifyIntegrity: () => {
            if (++checks !== 1) throw new Error("private final integrity failure");
            return { valid: true, eventCount: 2, headHash: rows[1]!.eventHash };
          },
        },
        limits,
      }),
    ).toThrowError(invalid);
    expect(() =>
      collectExecutionEventSourcePages({ events: store(history(1, 256 * 1024)), limits }),
    ).toThrowError(invalid);
    expect(collectExecutionEventSourcePages({ events: store([]), limits })).toEqual([]);
    expect(() =>
      collectExecutionEventSourcePages({ events, limits: { ...limits, maxFiles: 0 } }),
    ).toThrow(/aggregate limit/u);
  });

  it("leaves the scanner responsible for the aggregate of ordinary and supplemental bytes", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-paged-event-scan-"));
    try {
      await writeFile(resolve(root, "README.md"), "# Ordinary\n".repeat(200));
      const pages = collectExecutionEventSourcePages({ events: store(history(2)), limits });
      const supplementalSources = pages.flat();
      const eventBytes = supplementalSources.reduce(
        (sum, source) => sum + Buffer.byteLength(source.content),
        0,
      );
      await expect(
        scanRepositoryKnowledge({
          repositoryRoot: root,
          projectId: "prj_pagefixture",
          policy: {
            ...defaultRepositoryKnowledgePolicy,
            limits: { ...defaultRepositoryKnowledgePolicy.limits, maxTotalBytes: eventBytes },
          },
          supplementalSources,
          observeRevision: async () => ({ status: "unavailable", reason: "git_head_unavailable" }),
        }),
      ).rejects.toMatchObject({ code: "knowledge_source_limit_exceeded" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
