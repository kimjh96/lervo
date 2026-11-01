import { canonicalJson, computeEventHash } from "@lervo/event-contract";
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

function store(value: EventEnvelope): Pick<EventStore, "latest" | "list"> {
  return {
    latest: () => value,
    list: (options) =>
      value.seq > (options?.afterSeq ?? 0) ? [value].slice(0, options?.limit) : [],
  };
}

import {
  collectRecentExecutionEventSources,
  RecentExecutionEventProjection,
} from "../src/recent-execution-event-source.js";
import { collectVerificationResultSources } from "../src/verification-source.js";
import { longEventHistory } from "./long-event-history.js";

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
    list: (options?: { afterSeq?: number; limit?: number; types?: readonly string[] }) =>
      values
        .filter((item) => item.seq > (options?.afterSeq ?? 0))
        .filter((item) => options?.types === undefined || options.types.includes(item.type))
        .slice(0, options?.limit),
  };
}

describe("streaming recent execution evidence", () => {
  it("leaves verification results to a typed read instead of a shared traversal", async () => {
    const events = historyStore(history(2_003));
    const list = vi.spyOn(events, "list");
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
    });
    expect(verification).toEqual([]);
    expect(list).toHaveBeenCalledTimes(1);
    expect(list.mock.calls[0]![0]).toMatchObject({ types: ["verification.completed"] });
  });

  it("fails for an unreached observed head", () => {
    const events = historyStore(history(4));
    const head = events.latest()!;
    vi.spyOn(events, "latest").mockReturnValue({ ...head, eventHash: `sha256:${"f".repeat(64)}` });
    expect(() => collectRecentExecutionEventSources({ events, maximumEvents: 2 })).toThrowError(
      expect.objectContaining({ code: "knowledge_evidence_source_invalid" }),
    );
  });

  it("selects the same window when the store head is beyond 100,000 events", () => {
    const executionSeqs = [3, 99_999, 100_001, 149_998];
    const events = longEventHistory(150_000, executionSeqs);
    const recent = collectRecentExecutionEventSources({ events, maximumEvents: 2 });
    expect(recent.map((source) => JSON.parse(source.content).seq)).toEqual([100_001, 149_998]);
    expect(
      collectExecutionEventSources({ events }).map((source) => JSON.parse(source.content).seq),
    ).toEqual(executionSeqs);
    const projection = new RecentExecutionEventProjection(4);
    for (const seq of executionSeqs) projection.observe(events.at(seq));
    expect(projection.complete()).toBe(true);
    projection.observe(events.at(1));
    expect(projection.complete()).toBe(true);
    expect(new RecentExecutionEventProjection(2).complete()).toBe(true);
    const partial = new RecentExecutionEventProjection(2);
    for (const seq of executionSeqs) partial.observe(events.at(seq));
    expect(partial.complete()).toBe(false);
  });

  it("preserves a recent window after complete history exceeds its count and byte bounds", () => {
    const values = history(33_000);
    const events = historyStore(values);
    // ADR-0554: the legacy single corpus keeps its newest originals within 16 MiB, not failing.
    const legacy = collectExecutionEventSources({ events });
    const bytes = (count: number) =>
      values
        .slice(-count)
        .reduce((sum, value) => sum + Buffer.byteLength(`${canonicalJson(value)}\n`), 0);
    expect(legacy.length).toBeLessThan(32_768);
    expect(legacy.map((source) => source.path)).toEqual(
      values.slice(-legacy.length).map((value) => `@event/${value.eventId}`),
    );
    expect(bytes(legacy.length)).toBeLessThanOrEqual(16 * 1024 * 1024);
    expect(bytes(legacy.length + 1)).toBeGreaterThan(16 * 1024 * 1024);
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

  it("rejects a broken chain and unavailable snapshot pages instead of returning a partial window", () => {
    const value = event();
    const invalid = store({ ...value, previousHash: `sha256:${"e".repeat(64)}` });
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
