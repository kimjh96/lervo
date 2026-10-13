import type { OutcomeSupervisionSnapshotV1 } from "@lervo/application-contract";

import type { SupervisionDecisionReceipt } from "./outcome-supervision-ports.js";

export function assertReceipt(
  receipt: SupervisionDecisionReceipt,
  decisionId: string,
  planHash: string,
): void {
  if (
    receipt.decisionId !== decisionId ||
    receipt.planHash !== planHash ||
    !["recorded", "effect_confirmed", "uncertain", "superseded"].includes(receipt.status) ||
    !Array.isArray(receipt.effectEventIds) ||
    receipt.effectEventIds.length > 64 ||
    receipt.effectEventIds.some((id) => !/^evt_[a-f0-9]{32}$/u.test(id)) ||
    (receipt.status === "effect_confirmed" && receipt.effectEventIds.length === 0)
  ) {
    throw new Error("The supervision decision receipt conflicts with the exact plan.");
  }
}

/** The effect adapter's bounded identifier code, if it carries one; never its message. */
export function boundedErrorCode(error: unknown): string[] {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(code) ? [code] : [];
}

/** A leased or dispatched assignment is an unfinished duty, not a new request trigger. */
export function hasDurableWorkerContinuation(snapshot: OutcomeSupervisionSnapshotV1): boolean {
  return snapshot.assignments.some(
    (assignment) =>
      assignment.terminalEventId === null &&
      (assignment.status === "leased" || assignment.dispatchedAt !== null),
  );
}
