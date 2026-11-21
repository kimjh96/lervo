import type { ScopedWorkHandoffRequestV1 } from "@lervo/application-contract";

import { operatingHashPattern } from "./operating-contract-validation.js";
import { validScopedHandoffRequestShape } from "./scoped-work-handoff.js";

const REASON_CODE = /^[a-z][a-z0-9_]{0,63}$/u;
const ATTENTION_FIELDS = new Set(["reasonCode", "neededDecision", "observedNextActions"]);

type EscalationDetails =
  | { kind: "attention"; reasonCode: string }
  | { kind: "handoff"; recipientProjectId: string; request: ScopedWorkHandoffRequestV1 }
  | { kind: "invalid" };

function boundedText(value: unknown, maximumLength: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximumLength &&
    !/[\0-\x08\x0b\x0c\x0e-\x1f]/u.test(value)
  );
}

/**
 * Keeps local owner attention and recipient-bound handoff as disjoint effects. ADR-0608: it checks
 * details after the Node maps the owner's evidence references to hashes; the model returns none.
 */
export function classifyOwnerEscalationDetails(
  details: Record<string, unknown>,
): EscalationDetails {
  if (Object.hasOwn(details, "reasonCode")) {
    if (
      Object.keys(details).some((key) => !ATTENTION_FIELDS.has(key)) ||
      typeof details.reasonCode !== "string" ||
      !REASON_CODE.test(details.reasonCode) ||
      (details.neededDecision !== undefined && !boundedText(details.neededDecision, 1_024)) ||
      (details.observedNextActions !== undefined &&
        (!Array.isArray(details.observedNextActions) ||
          details.observedNextActions.length < 1 ||
          details.observedNextActions.length > 8 ||
          details.observedNextActions.some((value) => !boundedText(value, 512))))
    )
      return { kind: "invalid" };
    return { kind: "attention", reasonCode: details.reasonCode };
  }
  if (
    Object.keys(details).sort().join(",") !== "recipientProjectId,request" ||
    typeof details.recipientProjectId !== "string" ||
    !/^prj_[a-f0-9]{16}$/u.test(details.recipientProjectId) ||
    !validScopedHandoffRequestShape(details.request)
  )
    return { kind: "invalid" };
  return {
    kind: "handoff",
    recipientProjectId: details.recipientProjectId,
    request: details.request as ScopedWorkHandoffRequestV1,
  };
}

/** ADR-0608: checks acceptance details after the Node maps the owner's handoff reference. */
export function validOwnerHandoffAcceptanceDetails(details: Record<string, unknown>): boolean {
  return (
    Object.keys(details).join(",") === "handoffHash" &&
    typeof details.handoffHash === "string" &&
    operatingHashPattern.test(details.handoffHash)
  );
}
