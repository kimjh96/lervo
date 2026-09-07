import {
  LiveTriggerContractError,
  type LiveTriggerCompletionV1,
  type LiveTriggerAdmissionPlanV1,
} from "@lervo/live-trigger-contract";

const HASH = /^sha256:[a-f0-9]{64}$/u;
const IDENTIFIER = /^[a-z]{2,4}_[A-Za-z0-9_-]{16,86}$/u;

export interface ReservationRow extends Record<string, unknown> {
  reservation_id: string;
  invocation_fingerprint_hash: string;
  plan_id: string;
  status: "reserved" | "recovery_required" | "completed";
  completion_json: string | null;
}

export function decodeReservationRow(value: Record<string, unknown>): ReservationRow {
  if (
    typeof value.reservation_id !== "string" ||
    !IDENTIFIER.test(value.reservation_id) ||
    typeof value.invocation_fingerprint_hash !== "string" ||
    !HASH.test(value.invocation_fingerprint_hash) ||
    typeof value.plan_id !== "string" ||
    !IDENTIFIER.test(value.plan_id) ||
    !["reserved", "recovery_required", "completed"].includes(String(value.status)) ||
    (value.completion_json !== null && typeof value.completion_json !== "string") ||
    (value.status === "completed") !== (typeof value.completion_json === "string")
  ) {
    throw new LiveTriggerContractError(
      "store_evidence_invalid",
      "The live-trigger reservation evidence is invalid.",
    );
  }
  return value as ReservationRow;
}

export function assertReservationPlan(plan: LiveTriggerAdmissionPlanV1): void {
  if (
    plan.status !== "ready" ||
    plan.blockedReasons.length !== 0 ||
    !HASH.test(plan.sourceEventKeyHash) ||
    !HASH.test(plan.invocationFingerprintHash) ||
    !HASH.test(plan.authorizationHash) ||
    !IDENTIFIER.test(plan.planId) ||
    !Number.isSafeInteger(plan.maximumAcceptedTriggers) ||
    plan.maximumAcceptedTriggers < 1
  ) {
    throw new LiveTriggerContractError(
      "store_evidence_invalid",
      "The live-trigger reservation plan is invalid.",
    );
  }
}

export function assertCompletion(completion: LiveTriggerCompletionV1): void {
  if (
    completion.schemaVersion !== 1 ||
    !IDENTIFIER.test(completion.planId) ||
    !IDENTIFIER.test(completion.invocationId) ||
    !["materialized", "resumed", "already_materialized", "skipped", "coalesced"].includes(
      completion.disposition,
    ) ||
    !completion.assignmentIds.every((id) => IDENTIFIER.test(id)) ||
    !Number.isFinite(Date.parse(completion.completedAt))
  ) {
    throw new LiveTriggerContractError(
      "store_evidence_invalid",
      "The live-trigger completion evidence is invalid.",
    );
  }
}

export function decodeCompletion(value: unknown, planId: string): LiveTriggerCompletionV1 {
  if (typeof value !== "string") {
    throw new LiveTriggerContractError(
      "store_evidence_invalid",
      "The live-trigger completion evidence is missing.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new LiveTriggerContractError(
      "store_evidence_invalid",
      "The live-trigger completion evidence is unreadable.",
      { cause: error },
    );
  }
  assertCompletion(parsed as LiveTriggerCompletionV1);
  if ((parsed as LiveTriggerCompletionV1).planId !== planId) {
    throw new LiveTriggerContractError(
      "store_evidence_invalid",
      "The live-trigger completion does not match its plan.",
    );
  }
  return structuredClone(parsed as LiveTriggerCompletionV1);
}
