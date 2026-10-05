import { describe, expect, it } from "vitest";

import { documentFreshnessMayRun } from "../src/freshness-convergence-gate.js";

describe("document freshness convergence gate (ADR-0463 with ADR-0465)", () => {
  it("runs only while convergence is parked, never inside a batch-boundary stage", () => {
    for (const state of ["idle", "current", "waiting_authority", "attention_required"] as const)
      expect(documentFreshnessMayRun({ state }), state).toBe(true);
    for (const state of [
      "queued",
      "running",
      "waiting_review",
      "retry_scheduled",
      "stale",
      "recovery_required",
      "superseded",
    ] as const)
      expect(documentFreshnessMayRun({ state }), state).toBe(false);
  });
});
