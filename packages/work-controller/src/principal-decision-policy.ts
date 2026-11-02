import type { OperatingActionKind, OutcomeSupervisionReportV1 } from "@lervo/application-contract";
import { operatingTime } from "./operating-contract-validation.js";

/**
 * ADR-0453 `escalationBatchWindowMs`: how long an escalation stays an owner notice before the
 * principal proxy decides it (ADR-0561). The owner is never waited on past this bound.
 */
export const principalEscalationBoundMs = 1_800_000;

/** Escalations recorded since the latest mandate installation before the proxy always decides. */
export const principalEscalationCapacity = 8;

/** The installed operating mandate's reviewed authority, as the principal proxy may use it. */
export interface PrincipalMandateScope {
  actionKinds: readonly OperatingActionKind[];
  expiresAt: string;
}

export type PrincipalDecision =
  | { kind: "settle"; nextAction: OperatingActionKind; reasonCode: `principal_proxy_${string}` }
  | { kind: "lervo_debt"; reasonCode: "principal_scope_exceeded" | "principal_mandate_expired" };

/**
 * Settling actions per escalation reason, in preference order. A reason absent here (such as
 * another project's pending handoff acceptance) is outside every operating mandate.
 */
const settlingActions: Readonly<Record<string, readonly OperatingActionKind[]>> = {
  acceptance_rejected: ["revise_responsibility", "allocate_existing"],
  acceptance_blocked: ["revise_responsibility", "allocate_existing"],
  worker_failed: ["revise_responsibility", "allocate_existing"],
  assignment_blocked: ["revise_responsibility", "allocate_existing"],
  effect_outcome_uncertain: ["inspect_uncertain_effect"],
};

/**
 * Pure principal proxy decision for one escalation past the bound: the first in-mandate settling
 * action, or Lervo's own debt. It never returns an escalation, so nothing waits for the owner.
 */
export function decidePrincipalEscalation(input: {
  reasonCode: string;
  mandate: PrincipalMandateScope;
  now: string;
}): PrincipalDecision {
  if (
    !/^[a-z][a-z0-9_]{0,63}$/u.test(input.reasonCode) ||
    !Array.isArray(input.mandate.actionKinds) ||
    !operatingTime(input.mandate.expiresAt) ||
    !operatingTime(input.now)
  )
    throw new TypeError("The principal escalation input is invalid.");
  if (Date.parse(input.now) >= Date.parse(input.mandate.expiresAt))
    return { kind: "lervo_debt", reasonCode: "principal_mandate_expired" };
  const nextAction = (settlingActions[input.reasonCode] ?? []).find((action) =>
    input.mandate.actionKinds.includes(action),
  );
  return nextAction === undefined
    ? { kind: "lervo_debt", reasonCode: "principal_scope_exceeded" }
    : { kind: "settle", nextAction, reasonCode: `principal_proxy_${input.reasonCode}` };
}

/** Whether the escalation bound has passed, so pending owner attention no longer blocks work. */
export function principalEscalationBoundElapsed(input: {
  escalationCount: number;
  attentionPendingSince: string | null;
  now: string;
}): boolean {
  return (
    input.escalationCount >= principalEscalationCapacity ||
    (input.attentionPendingSince !== null &&
      Date.parse(input.now) - Date.parse(input.attentionPendingSince) >= principalEscalationBoundMs)
  );
}

/**
 * Applies the escalation bound to one projected report. Past the bound an escalation becomes the
 * proxy's in-mandate action or Lervo debt; without a principal the legacy capacity stop remains.
 */
export function settlePrincipalEscalation(input: {
  report: OutcomeSupervisionReportV1;
  principal: PrincipalMandateScope | null;
  escalationCount: number;
  now: string;
}): OutcomeSupervisionReportV1 {
  const { report } = input;
  if (report.nextAction !== "escalate") return report;
  if (input.principal === null)
    return input.escalationCount >= principalEscalationCapacity
      ? {
          ...report,
          status: "waiting_decision",
          reasonCode: "escalation_capacity_exceeded",
          nextAction: null,
        }
      : report;
  const decision = decidePrincipalEscalation({
    reasonCode: report.reasonCode,
    mandate: input.principal,
    now: input.now,
  });
  return decision.kind === "settle"
    ? {
        ...report,
        status: "recovering",
        reasonCode: decision.reasonCode,
        nextAction: decision.nextAction,
      }
    : // Debt stays held until its source changes; a past check time would re-record it each cycle.
      {
        ...report,
        status: "lervo_debt",
        reasonCode: decision.reasonCode,
        nextCheckAt: null,
        nextAction: null,
      };
}
