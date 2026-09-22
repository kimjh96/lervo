import type { OutcomeSupervisionReportV1 } from "@lervo/application-contract";
import type { SupervisionResourceBudgetV1 } from "@lervo/application-contract";

import { boundedHealthReasonCodes } from "./health-contract.js";
import type { NodeRuntimeComponentHealth } from "./health-contract.js";
import { NodeSupervisionError } from "./supervision-authority.js";

/**
 * Health reason codes for one recorded owner attention. A goal that completed without a
 * publication origin has nothing to publish, so its unavailable plan is reported as the local
 * result staying canonical rather than as a missing owner plan.
 */
export function supervisionAttentionReasonCodes(
  report: Pick<OutcomeSupervisionReportV1, "nextAction">,
  reasonCodes: readonly string[],
): string[] {
  if (!boundedHealthReasonCodes(reasonCodes)) return ["reason_codes_unbounded"];
  return reasonCodes.map((code) =>
    code === "owner_plan_unavailable" && report.nextAction === "publish_result"
      ? "local_result_canonical"
      : code,
  );
}

/** A goal-scoped budget stop needs user attention but does not make the Node service unavailable. */
export function supervisionAttentionHealth(input: {
  reasonCodes: string[] | null;
  resourceBudget?: SupervisionResourceBudgetV1 | undefined;
}): NodeRuntimeComponentHealth {
  return input.reasonCodes?.includes("aggregate_budget_exceeded") === true &&
    input.resourceBudget?.scope === "goal"
    ? {
        status: "attention",
        reasonCode: "goal_budget_insufficient",
        resourceBudget: { ...input.resourceBudget, scope: "goal" },
      }
    : {
        status: "unavailable",
        failureCode: "supervision_attention_required",
        ...(input.reasonCodes === null ? {} : { reasonCodes: [...input.reasonCodes] }),
      };
}

const CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/u;

/** One bounded code for a failed owner cycle so health and the journal can name it. */
export function supervisionCycleFailureCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && CODE_PATTERN.test(code)) return code;
  const name = error instanceof Error ? error.name : "";
  const derived = name
    .replace(/Error$/u, "")
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .toLowerCase();
  return derived.length > 0 && CODE_PATTERN.test(derived) ? derived : "cycle_error_unclassified";
}

/** A different current workstream parks this owner without making the Node unavailable. */
export function supervisionCycleHealth(error: unknown): NodeRuntimeComponentHealth {
  const code = supervisionCycleFailureCode(error);
  return error instanceof NodeSupervisionError && error.code === "supervision_workstream_inactive"
    ? { status: "dormant", reasonCode: "workstream_inactive" }
    : {
        status: "unavailable",
        failureCode: "supervision_cycle_failed",
        reasonCodes: [code],
      };
}

/** Journal line for a failed cycle: bounded code, error name, and the message's first 200 characters. */
export function supervisionCycleFailureLine(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error))
    .replace(/[\r\n\0]+/gu, " ")
    .slice(0, 200);
  const name = error instanceof Error ? error.name : "unknown";
  return `Lervo supervision cycle failed (${supervisionCycleFailureCode(error)}): ${name}: ${message}`;
}
