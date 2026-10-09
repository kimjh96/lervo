import { describe, expect, it } from "vitest";

import { mapKnowledgeReads } from "../src/knowledge-read-scheduling.js";

describe("knowledge read scheduling", () => {
  it("visits the complete input and preserves order when reads finish out of order", async () => {
    const inputs = Array.from({ length: 137 }, (_, index) => index);
    const visited: number[] = [];
    let releaseFirst!: () => void;
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let active = 0;
    let peak = 0;
    const results = await mapKnowledgeReads(inputs, async (index) => {
      active++;
      peak = Math.max(peak, active);
      if (index === 0) await first;
      if (index === 20) releaseFirst();
      visited.push(index);
      active--;
      return `result:${index}`;
    });
    expect(visited[0]).not.toBe(0);
    expect([...visited].sort((left, right) => left - right)).toEqual(inputs);
    expect(results).toEqual(inputs.map((index) => `result:${index}`));
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(8);
    expect(await mapKnowledgeReads([], async () => "unused")).toEqual([]);
  });

  it("drains started reads before rejecting and does not turn a failure into partial success", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const failure = new Error("unreadable");
    let drained = false;
    let settled = false;
    const result = mapKnowledgeReads([0, 1], async (index) => {
      if (index === 0) throw failure;
      await pending;
      drained = true;
      return index;
    });
    const rejection = expect(result).rejects.toBe(failure);
    void result.catch(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    await rejection;
    expect(drained).toBe(true);
  });
});
