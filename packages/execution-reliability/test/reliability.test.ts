import { describe, expect, it } from "vitest";

import {
  assertFoundationThreatModel,
  assertGrowingCollectionCoverage,
  createEventTelemetryRegistry,
  createRecoveryMatrix,
  foundationEffectInventory,
  foundationThreatModel,
} from "../src/index.js";

describe("foundation adverse-condition contracts", () => {
  it("covers every effect with deterministic recovery outcomes", () => {
    const matrix = createRecoveryMatrix(foundationEffectInventory);
    expect(matrix).toHaveLength(foundationEffectInventory.length * 5);
    expect(matrix.every((item) => item.status === "passed")).toBe(true);
    expect(
      matrix
        .filter((item) => item.faultPoint === "uncertain_external_response")
        .every((item) => item.observed === "recovery_required"),
    ).toBe(true);
  });

  it("binds every effect collection to a capacity or retention contract", () => {
    expect(() =>
      assertGrowingCollectionCoverage(
        foundationEffectInventory.flatMap((effect) => effect.growingCollectionIds),
      ),
    ).not.toThrow();
  });

  it("covers every allowlisted event field and keeps third-party execution disabled", () => {
    const registry = createEventTelemetryRegistry();
    expect(registry.length).toBeGreaterThan(100);
    expect(new Set(registry.map((item) => `${item.eventType}.${item.field}`)).size).toBe(
      registry.length,
    );
    expect(() => assertFoundationThreatModel()).not.toThrow();
    expect(
      foundationThreatModel.find((item) => item.threatId === "untrusted_third_party_execution"),
    ).toMatchObject({ disposition: "disabled_pending_isolation" });
  });
});
