import { describe, expect, it } from "vitest";
import {
  canReplaceExhaustedDelivery,
  hasExactRecoveryQueues,
} from "../src/supervision-result-delivery-recovery.js";

describe("result delivery recovery", () => {
  const exhausted = {
    queuedCount: 1,
    workstreamCompleted: true,
    status: "failed" as const,
    attempt: 4,
    nextCheckAt: null,
    replay: "absent" as const,
  };

  it("allows one replacement only when transport never reserved the original outbound", () => {
    expect(canReplaceExhaustedDelivery(exhausted)).toBe(true);
    for (const replay of ["sending", "unknown", "rejected", "delivered"] as const) {
      expect(canReplaceExhaustedDelivery({ ...exhausted, replay })).toBe(false);
    }
    expect(canReplaceExhaustedDelivery({ ...exhausted, queuedCount: 2 })).toBe(false);
    expect(canReplaceExhaustedDelivery({ ...exhausted, attempt: 3 })).toBe(false);
    expect(canReplaceExhaustedDelivery({ ...exhausted, workstreamCompleted: false })).toBe(false);
  });

  it("rechecks the same original after the exact replacement was queued", () => {
    expect(hasExactRecoveryQueues(["old"])).toBe(true);
    expect(hasExactRecoveryQueues(["old", "replacement"], "replacement")).toBe(true);
    expect(hasExactRecoveryQueues(["old", "other"], "replacement")).toBe(false);
    expect(hasExactRecoveryQueues(["old", "replacement", "third"], "replacement")).toBe(false);
    expect(hasExactRecoveryQueues(["old", "replacement"])).toBe(false);
  });
});
