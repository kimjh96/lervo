import type { EventEnvelope } from "@lervo/schemas";
import { describe, expect, it } from "vitest";

import { summarizeSessionTurns } from "../src/turn-summary-service.js";

const digest = `sha256:${"a".repeat(64)}`;
const other = `sha256:${"b".repeat(64)}`;
let seq = 0;

/** A record as the store returns it; only the fields the summary reads matter. */
function event(type: string, atMs: number, payload: Record<string, unknown>, eventId?: string) {
  seq += 1;
  return {
    seq,
    eventId: eventId ?? `evt_${seq.toString().padStart(8, "0")}`,
    type,
    occurredAt: new Date(atMs).toISOString(),
    payload,
  } as unknown as EventEnvelope;
}

const usage = (atMs: number, sessionDigest: string, cost: number | null) =>
  event("resource.usage.recorded", atMs, {
    hostedSession: { provider: "claude", providerSessionDigest: sessionDigest },
    usage: { inputTokens: 1000, cachedInputTokens: 800, outputTokens: 50 },
    costUsd: cost,
  });

describe("turn summaries from a session's records", () => {
  it("matches each turn to its prompt's context and reads what the core recorded", () => {
    const first = event(
      "terminal.context.prepared",
      10_500,
      { providerSessionDigest: digest, workstreamRevision: 5 },
      "evt_context_one",
    );
    const observed = event(
      "terminal.turn.observed",
      20_000,
      {
        contextEventId: "evt_context_one",
        referenceCount: 2,
        repositoryChanged: true,
        finalWorkstreamRevision: 6,
        completionResult: "allowed",
      },
      "evt_turn_one",
    );
    const searched = ["docs/a.md", "docs/b.md"].map((path) =>
      event("context.selected", 12_000, {
        contextEventId: "evt_context_one",
        origin: "agent_query",
        path,
      }),
    );
    const given = event("context.selected", 10_600, {
      contextEventId: "evt_context_one",
      origin: "managed_turn",
      path: "docs/rules.md",
    });
    const second = event(
      "terminal.context.prepared",
      40_200,
      { providerSessionDigest: digest, workstreamRevision: 6 },
      "evt_context_two",
    );
    const stopped = event("terminal.turn.observed", 45_000, {
      contextEventId: "evt_context_two",
      completionResult: "not_checked",
      ending: "next_prompt",
      repositoryChanged: false,
    });
    const change = event("repository.change.completed", 20_001, {
      sourceEventId: "evt_turn_one",
      changedPathCount: 3,
    });
    const result = summarizeSessionTurns(
      {
        session: [first, given, ...searched, observed, second, stopped],
        usage: [usage(19_000, digest, 0.25), usage(21_000, digest, 0.05), usage(19_500, other, 9)],
        changes: [change],
      },
      digest,
      [{ startedAtMs: 10_000 }, { startedAtMs: 40_000 }, { startedAtMs: 90_000 }],
    );
    expect(result.turns).toEqual([
      {
        given: { documents: 1, workstreamRevision: 5 },
        searched: { documents: 2, paths: ["docs/a.md", "docs/b.md"] },
        cited: 2,
        outcome: {
          repositoryChanged: true,
          changedPaths: 3,
          workstreamRevision: 6,
          completion: "allowed",
        },
        usage: { inputTokens: 2000, cachedInputTokens: 1600, outputTokens: 100, costUsd: 0.3 },
      },
      {
        given: { documents: 0, workstreamRevision: 6 },
        searched: { documents: 0, paths: [] },
        cited: 0,
        outcome: { repositoryChanged: false, completion: "not_checked", ending: "next_prompt" },
      },
      // The core recorded no prompt for this turn.
      null,
    ]);
  });

  it("leaves out a cost any of the turn's results did not report", () => {
    const context = event("terminal.context.prepared", 1_000, { providerSessionDigest: digest });
    const [turn] = summarizeSessionTurns(
      {
        session: [context],
        usage: [usage(2_000, digest, 0.1), usage(3_000, digest, null)],
        changes: [],
      },
      digest,
      [{ startedAtMs: 1_000 }],
    ).turns;
    expect(turn?.usage).toEqual({ inputTokens: 2000, cachedInputTokens: 1600, outputTokens: 100 });
    expect(turn?.outcome).toEqual({ repositoryChanged: false, completion: "not_checked" });
  });

  it("counts only the usage before a turn's end", () => {
    const context = event("terminal.context.prepared", 1_000, { providerSessionDigest: digest });
    const [turn] = summarizeSessionTurns(
      {
        session: [context],
        usage: [usage(2_000, digest, 0.1), usage(9_000, digest, 0.2)],
        changes: [],
      },
      digest,
      [{ startedAtMs: 1_000, endedAtMs: 13_000 }],
    ).turns;
    // The turn ends 5 s before the next message, for the clock slack the context may have.
    expect(turn?.usage?.costUsd).toBeCloseTo(0.1);
  });
});
