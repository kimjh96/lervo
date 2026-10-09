import { computeEventHash } from "@lervo/event-contract";
import type { EventEnvelope } from "@lervo/schemas";
import type { EventStore } from "@lervo/storage-contract";
import { describe, expect, it, vi } from "vitest";

import { collectExecutionEventSources } from "../src/execution-event-source.js";

function event(
  payload: Record<string, unknown> = {
    requestDigest: `sha256:${"a".repeat(64)}`,
    role: "developer",
    risk: "low",
  },
): EventEnvelope {
  const withoutHash: Omit<EventEnvelope, "eventHash"> = {
    eventId: "evt_executionfixture",
    projectId: "prj_executionfixture",
    runId: "run_executionfixture",
    sessionId: "ses_executionfixture",
    seq: 1,
    type: "run.requested",
    occurredAt: "2026-08-23T00:00:00.000Z",
    actor: { kind: "user" },
    schemaVersion: 1,
    policyVersion: `sha256:${"b".repeat(64)}`,
    payload,
    previousHash: null,
  };
  return { ...withoutHash, eventHash: computeEventHash(withoutHash) };
}

function store(value: EventEnvelope): Pick<EventStore, "latest" | "list" | "verifyIntegrity"> {
  return {
    latest: () => value,
    list: (options) =>
      value.seq > (options?.afterSeq ?? 0) ? [value].slice(0, options?.limit) : [],
    verifyIntegrity: () => ({ valid: true, eventCount: 1, headHash: value.eventHash }),
  };
}

import {
  collectRecentExecutionEventSources,
  RecentExecutionEventProjection,
} from "../src/recent-execution-event-source.js";
import { collectVerificationResultSources } from "../src/verification-source.js";

function history(count: number): EventEnvelope[] {
  let previousHash: string | null = null;
  return Array.from({ length: count }, (_, index) => {
    const original = event();
    const { eventHash: _hash, ...withoutHash } = original;
    const next = {
      ...withoutHash,
      eventId: `evt_history${String(index).padStart(8, "0")}`,
      seq: index + 1,
      previousHash,
    };
    const result = { ...next, eventHash: computeEventHash(next) };
    previousHash = result.eventHash;
    return result;
  });
}

function historyStore(values: EventEnvelope[]) {
  return {
    latest: () => values.at(-1) ?? null,
    list: (options?: { afterSeq?: number; limit?: number }) =>
      values.filter((item) => item.seq > (options?.afterSeq ?? 0)).slice(0, options?.limit),
    verifyIntegrity: () => ({
      valid: true as const,
      eventCount: values.length,
      headHash: values.at(-1)?.eventHash ?? null,
    }),
  };
}

describe("streaming recent execution evidence", () => {
  it("shares a complete verification traversal without changing recent evidence", async () => {
    const values = history(2_003);
    const events = historyStore(values);
    const expected = collectRecentExecutionEventSources({ events, maximumEvents: 4_096 });
    const list = vi.spyOn(events, "list");
    const integrity = vi.spyOn(events, "verifyIntegrity");
    const recent = new RecentExecutionEventProjection(4_096);
    const verification = await collectVerificationResultSources({
      events,
      artifacts: {
        get: async () => {
          throw new Error("No verification artifact expected.");
        },
      },
      loadSuite: async () => {
        throw new Error("No verification suite expected.");
      },
      observeEvent: (event) => recent.observe(event),
    });
    expect(verification).toEqual([]);
    expect(recent.sources()).toEqual(expected);
    expect(list).toHaveBeenCalledTimes(3);
    expect(integrity).toHaveBeenCalledTimes(2);
  });

  it("fails the shared traversal for unsafe older bytes and failed final integrity", async () => {
    const values = history(4);
    values[0] = event({
      requestDigest: `sha256:${"a".repeat(64)}`,
      role: "developer",
      prompt: "private-old-source",
    });
    const input = {
      artifacts: { get: async () => new Uint8Array() },
      loadSuite: async () => {
        throw new Error("No verification suite expected.");
      },
    };
    const recent = new RecentExecutionEventProjection(2);
    await expect(
      collectVerificationResultSources({
        ...input,
        events: historyStore(values),
        observeEvent: (event) => recent.observe(event),
      }),
    ).rejects.toMatchObject({ code: "knowledge_evidence_source_invalid" });
    const events = historyStore(history(4));
    vi.spyOn(events, "verifyIntegrity")
      .mockImplementationOnce(() => ({
        valid: true,
        eventCount: 4,
        headHash: events.latest()!.eventHash,
      }))
      .mockImplementationOnce(() => {
        throw new Error("changed history");
      });
    await expect(
      collectVerificationResultSources({
        ...input,
        events,
        observeEvent: (event) => new RecentExecutionEventProjection(2).observe(event),
      }),
    ).rejects.toMatchObject({ code: "knowledge_evidence_source_invalid" });
  });

  it("preserves a recent window after complete history exceeds its count and byte bounds", () => {
    const values = history(33_000);
    const events = historyStore(values);
    expect(() => collectExecutionEventSources({ events })).toThrowError(
      expect.objectContaining({ code: "knowledge_evidence_source_invalid" }),
    );
    const sources = collectRecentExecutionEventSources({ events, maximumEvents: 4_096 });
    expect(sources).toHaveLength(4_096);
    expect(sources.map((source) => JSON.parse(source.content).seq)).toEqual(
      values.slice(-4_096).map((value) => value.seq),
    );
    expect(events.latest()).toBe(values.at(-1));
    // 33,000 synthetic events take about 4 s alone; a loaded host or CI runner needs more.
  }, 60_000);

  it("rejects unsafe old evidence even after it would leave the retained window", () => {
    const values = history(4);
    values[0] = event({
      requestDigest: `sha256:${"a".repeat(64)}`,
      role: "developer",
      risk: "low",
      prompt: "private-old-source",
    });
    expect(() =>
      collectRecentExecutionEventSources({ events: historyStore(values), maximumEvents: 2 }),
    ).toThrowError(expect.objectContaining({ code: "knowledge_evidence_source_invalid" }));
    expect(() =>
      collectRecentExecutionEventSources({ events: historyStore(values), maximumEvents: 2 }),
    ).not.toThrow("private-old-source");
  });

  it("rejects broken integrity and unavailable snapshot pages instead of returning a partial window", () => {
    const value = event();
    const invalid = {
      ...store(value),
      verifyIntegrity: () => {
        throw new Error("private integrity diagnostic");
      },
    };
    expect(() =>
      collectRecentExecutionEventSources({ events: invalid, maximumEvents: 2 }),
    ).toThrowError(expect.objectContaining({ code: "knowledge_evidence_source_invalid" }));
    expect(() =>
      collectRecentExecutionEventSources({
        events: { ...store(value), list: () => [] },
        maximumEvents: 2,
      }),
    ).toThrowError(expect.objectContaining({ code: "knowledge_evidence_source_invalid" }));
  });

  it("checks window admission bounds and an empty history", () => {
    const events = historyStore([]);
    expect(collectRecentExecutionEventSources({ events, maximumEvents: 1 })).toEqual([]);
    for (const maximumEvents of [0, -1, 32_769, 1.5])
      expect(() => collectRecentExecutionEventSources({ events, maximumEvents })).toThrow(
        /window limit/u,
      );
  });
});
