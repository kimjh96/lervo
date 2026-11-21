import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { freshnessBackoffDue } from "../src/freshness-debt-state.js";
import { documentFreshnessAttentionSources } from "../src/freshness-review.js";
import { emptyFreshnessCycleState, FRESHNESS_CYCLE_PATH } from "../src/freshness-state-store.js";
import { freshnessUsagePauseEndsAt, nextUsageUnavailable } from "../src/freshness-usage-pause.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** ADR-0604: a provider that reports no usage is paused, woken for, and reported only meanwhile. */
describe("the freshness usage pause", () => {
  const now = new Date("2026-11-21T00:00:00.000Z");

  it("counts every answer without usage, a disagreement too, and clears on usage", () => {
    let pause = nextUsageUnavailable(null, "claude", false, now);
    expect(pause).toMatchObject({ count: 1, until: null });
    // A disagreement without usage is still an answer without usage: no reset.
    pause = nextUsageUnavailable(pause, "claude", false, now);
    pause = nextUsageUnavailable(pause, "claude", false, now);
    expect(pause).toMatchObject({ count: 3, until: "2026-11-22T00:00:00.000Z" });
    // A review that got no answer leaves the count; one with usage clears it.
    expect(nextUsageUnavailable(pause, "claude", undefined, now)).toBe(pause);
    expect(nextUsageUnavailable(pause, "claude", true, now)).toBeNull();
    // Another provider starts its own count.
    expect(nextUsageUnavailable(pause, "codex", false, now)).toMatchObject({ count: 1 });
  });

  it("wakes the resident when the pause ends, reopens the stage, and ends its attention", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-freshness-pause-"));
    roots.push(root);
    const until = "2026-11-22T00:00:00.000Z";
    const state = {
      ...emptyFreshnessCycleState(),
      usageUnavailable: { provider: "claude", count: 3, since: now.toISOString(), until },
    };
    await mkdir(resolve(root, FRESHNESS_CYCLE_PATH, ".."), { recursive: true });
    await writeFile(resolve(root, FRESHNESS_CYCLE_PATH), JSON.stringify(state));
    expect(freshnessUsagePauseEndsAt(root, now.getTime())).toBe(Date.parse(until));
    expect(freshnessUsagePauseEndsAt(root, Date.parse(until) + 1)).toBeNull();
    expect(freshnessBackoffDue(state, [], now)).toBe(false);
    expect(freshnessBackoffDue(state, [], new Date(until))).toBe(true);
    expect((await documentFreshnessAttentionSources(root, now)).usageUnavailable).toMatchObject({
      count: 3,
    });
    expect(
      (await documentFreshnessAttentionSources(root, new Date(Date.parse(until) + 1)))
        .usageUnavailable,
    ).toBeNull();
  });
});
