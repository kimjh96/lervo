import type { HostedTurnUsage } from "@lervo/adapter-contract";
import { CLAUDE_HOSTED_USAGE_ACCOUNTING } from "@lervo/adapter-claude";
import { describe, expect, it } from "vitest";

import { MAX_QUEUED_TURN_USAGE, TurnUsageQueue } from "../src/core-link-usage-queue.js";

const accounting = CLAUDE_HOSTED_USAGE_ACCOUNTING;
const turn = (turnKey: string): HostedTurnUsage => ({
  turnKey,
  resultIndex: 0,
  modelKey: "claude-haiku-5-5",
  model: "claude-haiku-5-5",
  uncachedInputTokens: 1,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  outputTokens: 1,
  reasoningOutputTokens: null,
  contextWindow: null,
  costUsd: null,
  costBasis: "unreported",
});

describe("the resident's turn usage queue", () => {
  it("records batches in order, and counts what the screen refused", async () => {
    const seen: string[] = [];
    const queue = new TurnUsageQueue(async (sessionId, _accounting, usage) => {
      seen.push(`${sessionId}:${usage.map((item) => item.turnKey).join(",")}`);
      return { status: "recorded", recorded: usage.length - 1, duplicates: 0, dropped: 1 };
    });
    queue.push("s1", accounting, [turn("a"), turn("b")]);
    queue.push("s2", accounting, [turn("c")]);
    await queue.idle();
    expect(seen).toEqual(["s1:a,b", "s2:c"]);
    expect(queue.dropped).toBe(2);
  });

  it("holds at most its bound while the store stalls, dropping and counting the rest", async () => {
    let release = () => {};
    const stalled = new Promise<void>((resolve) => {
      release = resolve;
    });
    let stored = 0;
    const queue = new TurnUsageQueue(async (_sessionId, _accounting, usage) => {
      await stalled;
      stored += usage.length;
      return { status: "recorded", recorded: usage.length, duplicates: 0, dropped: 0 };
    });
    const many = Array.from({ length: MAX_QUEUED_TURN_USAGE + 10 }, (_, index) =>
      turn(`t${index}`),
    );
    queue.push("s1", accounting, many);
    queue.push("s1", accounting, [turn("late")]);
    release();
    await queue.idle();
    expect(stored).toBe(MAX_QUEUED_TURN_USAGE);
    expect(queue.dropped).toBe(11);
  });

  it("counts a batch whose recording failed as dropped, and goes on", async () => {
    const queue = new TurnUsageQueue(async (sessionId, _accounting, usage) => {
      if (sessionId === "broken") throw new Error("store unavailable");
      return { status: "recorded", recorded: usage.length, duplicates: 0, dropped: 0 };
    });
    queue.push("broken", accounting, [turn("a"), turn("b")]);
    queue.push("s1", accounting, [turn("c")]);
    await queue.idle();
    expect(queue.dropped).toBe(2);
  });

  it("counts a batch whose descriptor could not be stored as dropped", async () => {
    const queue = new TurnUsageQueue(async () => ({ status: "descriptor_unavailable" }));
    queue.push("s1", accounting, [turn("a"), turn("b")]);
    await queue.idle();
    expect(queue.dropped).toBe(2);
  });
});
