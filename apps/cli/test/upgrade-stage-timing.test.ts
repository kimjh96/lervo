import { describe, expect, it } from "vitest";

import { UpgradeStageClock } from "../src/upgrade-stage-timing.js";

function clockAt(...instants: number[]): UpgradeStageClock {
  const queue = [...instants];
  return new UpgradeStageClock(() => {
    const next = queue.shift();
    if (next === undefined) throw new Error("The test clock ran out of instants.");
    return next;
  });
}

describe("the upgrade stage clock", () => {
  it("laps consecutive parts that sum to the apply's wall time", () => {
    const clock = clockAt(1_000, 1_250.4, 1_250.4, 9_000.6);
    clock.lap("plan");
    clock.lap("capabilities");
    clock.lap("final_plan");
    expect(clock.timings).toEqual([
      { stage: "plan", ms: 250 },
      { stage: "capabilities", ms: 0 },
      { stage: "final_plan", ms: 7_750 },
    ]);
  });

  it("splits the Node stage into the onboarding's parts and counts the rest as preparation", () => {
    const clock = clockAt(0, 500, 20_500, 21_000);
    clock.lap("node_inspection");
    clock.lapNode({
      preparationMs: 3_000,
      serviceMs: 2_000,
      readinessMs: 4_000,
      completionMs: 6_000,
    });
    clock.lapNode(undefined);
    expect(clock.timings).toEqual([
      { stage: "node_inspection", ms: 500 },
      { stage: "node_preparation", ms: 8_000 },
      { stage: "node_service", ms: 2_000 },
      { stage: "node_readiness", ms: 4_000 },
      { stage: "node_completion", ms: 6_000 },
      { stage: "node", ms: 500 },
    ]);
    expect(clock.timings.reduce((sum, timing) => sum + timing.ms, 0)).toBe(21_000);
  });
});
