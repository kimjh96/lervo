import { describe, expect, it } from "vitest";

import {
  assertCompleteEffectInventory,
  assertEffectBoundaryContract,
  effectBoundaryCategories,
  effectBoundaryContractDigest,
  projectEffectRecovery,
  type EffectBoundaryContract,
} from "../src/index.js";

function contract(
  effectKind: EffectBoundaryContract["effectKind"] = "repository",
): EffectBoundaryContract {
  return {
    schemaVersion: 1,
    effectId: "effect_fixture_apply",
    category: "managed_repository_write",
    owner: "fixture",
    effectKind,
    idempotencyCoordinate: "fixture.plan_id",
    duplicateBehavior: "reject_conflict",
    automaticRetry: effectKind === "external" ? "disabled" : "before_effect_only",
    uncertainty: effectKind === "external" ? "reconcile_required" : "journal_recovery",
    cancellation: {
      beforeStart: "cancelled_without_effect",
      duringEffect:
        effectKind === "external" ? "reconcile_required" : "rollback_or_recovery_required",
      afterEffect: "complete_or_recovery_required",
    },
    compensation: effectKind === "external" ? "external_reconciliation" : "restore_exact_bytes",
    durableSuccessEvidence: "fixture.applied",
    absenceMeaning: "not_completed_or_unobserved",
    recoveryOwner: "fixture",
    privacySafeFailureCode: "fixture_recovery_required",
    growingCollectionIds: ["fixture_journal"],
  };
}

describe("effect safety contract", () => {
  it("distinguishes exact completion, exact rollback, and uncertainty", () => {
    const local = contract();
    expect(
      projectEffectRecovery(local, {
        state: "after",
        successEvidence: "present",
        externalObservation: "not_applicable",
      }),
    ).toBe("exact_completion");
    expect(
      projectEffectRecovery(local, {
        state: "before",
        successEvidence: "absent",
        externalObservation: "not_applicable",
      }),
    ).toBe("exact_rollback");
    expect(
      projectEffectRecovery(local, {
        state: "after",
        successEvidence: "absent",
        externalObservation: "not_applicable",
      }),
    ).toBe("recovery_required");
  });

  it("never infers an external result without reconciliation", () => {
    const external = contract("external");
    expect(
      projectEffectRecovery(external, {
        state: "after",
        successEvidence: "present",
        externalObservation: "unknown",
      }),
    ).toBe("recovery_required");
    expect(() =>
      assertEffectBoundaryContract({ ...external, automaticRetry: "before_effect_only" }),
    ).toThrow("fail closed on uncertainty");
  });

  it("binds contract identity and requires every effect category", () => {
    expect(effectBoundaryContractDigest(contract())).toMatch(/^sha256:[a-f0-9]{64}$/u);
    const complete = effectBoundaryCategories.map((category, index) => ({
      ...contract(),
      effectId: `effect_fixture_${String(index).padStart(2, "0")}`,
      category,
    }));
    expect(() => assertCompleteEffectInventory(complete)).not.toThrow();
    expect(() => assertCompleteEffectInventory(complete.slice(1))).toThrow(
      "Effect inventory categories are missing",
    );
  });
});
