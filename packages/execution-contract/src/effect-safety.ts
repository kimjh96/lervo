import { createHash } from "node:crypto";

export const effectBoundaryCategories = [
  "provider_admission",
  "event_append",
  "artifact_append",
  "managed_repository_write",
  "assignment_transition",
  "lease_transition",
  "workspace_effect",
  "terminal_persistence",
  "capability_activation",
  "synchronization",
  "remote_command",
  "external_deployment",
  "repository_migration",
] as const;

export type EffectBoundaryCategory = (typeof effectBoundaryCategories)[number];
export type EffectKind = "local" | "repository" | "external";
export type EffectRecoveryOutcome = "exact_completion" | "exact_rollback" | "recovery_required";

export interface EffectBoundaryContract {
  schemaVersion: 1;
  effectId: string;
  category: EffectBoundaryCategory;
  owner: string;
  effectKind: EffectKind;
  idempotencyCoordinate: string;
  duplicateBehavior: "same_result" | "reject_conflict" | "reconcile";
  automaticRetry: "before_effect_only" | "content_idempotent" | "disabled";
  uncertainty: "journal_recovery" | "reconcile_required";
  cancellation: {
    beforeStart: "cancelled_without_effect";
    duringEffect: "rollback_or_recovery_required" | "reconcile_required";
    afterEffect: "complete_or_recovery_required";
  };
  compensation: "restore_exact_bytes" | "release_authority" | "external_reconciliation";
  durableSuccessEvidence: string;
  absenceMeaning: "not_completed_or_unobserved";
  recoveryOwner: string;
  privacySafeFailureCode: string;
  growingCollectionIds: string[];
}

export interface EffectRecoveryObservation {
  state: "before" | "after" | "unknown";
  successEvidence: "present" | "absent" | "unknown";
  externalObservation: "not_applicable" | "confirmed_applied" | "confirmed_absent" | "unknown";
}

const EFFECT_ID = /^effect_[a-z][a-z0-9_]{2,79}$/u;
const TOKEN = /^[a-z][a-z0-9_.:-]{1,127}$/u;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function assertEffectBoundaryContract(value: EffectBoundaryContract): void {
  if (
    value.schemaVersion !== 1 ||
    !EFFECT_ID.test(value.effectId) ||
    !effectBoundaryCategories.includes(value.category) ||
    !TOKEN.test(value.owner) ||
    !TOKEN.test(value.idempotencyCoordinate) ||
    !TOKEN.test(value.durableSuccessEvidence) ||
    !TOKEN.test(value.recoveryOwner) ||
    !TOKEN.test(value.privacySafeFailureCode) ||
    value.absenceMeaning !== "not_completed_or_unobserved" ||
    value.growingCollectionIds.length > 16 ||
    new Set(value.growingCollectionIds).size !== value.growingCollectionIds.length ||
    value.growingCollectionIds.some((item) => !TOKEN.test(item))
  ) {
    throw new TypeError("An effect boundary contract is invalid.");
  }
  if (
    value.effectKind === "external" &&
    (value.uncertainty !== "reconcile_required" ||
      value.automaticRetry !== "disabled" ||
      value.cancellation.duringEffect !== "reconcile_required" ||
      value.compensation !== "external_reconciliation")
  ) {
    throw new TypeError("An external effect must fail closed on uncertainty.");
  }
}

export function effectBoundaryContractDigest(value: EffectBoundaryContract): string {
  assertEffectBoundaryContract(value);
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

export function projectEffectRecovery(
  contract: EffectBoundaryContract,
  observation: EffectRecoveryObservation,
): EffectRecoveryOutcome {
  assertEffectBoundaryContract(contract);
  const externalCompleted =
    contract.effectKind !== "external" || observation.externalObservation === "confirmed_applied";
  if (
    observation.successEvidence === "present" &&
    observation.state === "after" &&
    externalCompleted
  ) {
    return "exact_completion";
  }
  const externalAbsent =
    contract.effectKind !== "external" || observation.externalObservation === "confirmed_absent";
  if (
    observation.successEvidence === "absent" &&
    observation.state === "before" &&
    externalAbsent
  ) {
    return "exact_rollback";
  }
  return "recovery_required";
}

export function assertCompleteEffectInventory(contracts: readonly EffectBoundaryContract[]): void {
  const ids = new Set<string>();
  const categories = new Set<EffectBoundaryCategory>();
  for (const contract of contracts) {
    assertEffectBoundaryContract(contract);
    if (ids.has(contract.effectId)) throw new TypeError("An effect boundary ID is duplicated.");
    ids.add(contract.effectId);
    categories.add(contract.category);
  }
  const missing = effectBoundaryCategories.filter((category) => !categories.has(category));
  if (missing.length > 0) {
    throw new TypeError(`Effect inventory categories are missing: ${missing.join(", ")}.`);
  }
}
