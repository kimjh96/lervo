import type {
  OperatingActionPlanV1,
  OutcomeSupervisionReportV1,
} from "@lervo/application-contract";
import type { SupervisionResourceBudgetV1 } from "@lervo/application-contract";

import { boundedHealthReasonCodes } from "./health-contract.js";
import type { NodeRuntimeComponentHealth } from "./health-contract.js";
import { NodeSupervisionError } from "./supervision-authority.js";

/** A missing publication proposal cannot prove that the goal was locally bound. */
export function supervisionAttentionReasonCodes(
  _report: Pick<OutcomeSupervisionReportV1, "nextAction">,
  reasonCodes: readonly string[],
): string[] {
  if (!boundedHealthReasonCodes(reasonCodes)) return ["reason_codes_unbounded"];
  return [...reasonCodes];
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

/** Journal line for a failed cycle: bounded reason and bundle coordinate without a local path. */
export function supervisionCycleFailureLine(error: unknown): string {
  const origin =
    error instanceof Error
      ? /\b(bin\.js:[1-9][0-9]{0,7}:[1-9][0-9]{0,7})\)?$/u.exec(
          error.stack?.split("\n")[1] ?? "",
        )?.[1]
      : undefined;
  const detail = boundedError(error, 200);
  return `Lervo supervision cycle failed (${supervisionCycleFailureCode(error)}): ${detail}${origin === undefined ? "" : ` origin=${origin}`}`;
}

/** Journal line for an effect whose outcome became uncertain; canonical attention keeps only codes. */
export function supervisionEffectFailureLine(
  plan: Pick<OperatingActionPlanV1, "effectContract" | "actionKind">,
  error: unknown,
): string {
  return `Lervo supervision effect uncertain (${plan.actionKind} ${plan.effectContract}): ${boundedError(error, 400)}`;
}

function boundedError(error: unknown, limit: number): string {
  // A wrapped failure such as workforce_write_failed hides its real reason in the cause chain.
  const causes: string[] = [];
  let cause = (error as { cause?: unknown } | null)?.cause;
  for (let depth = 0; depth < 3 && cause !== undefined && cause !== null; depth += 1) {
    causes.push(cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause));
    cause = (cause as { cause?: unknown }).cause;
  }
  const message = [error instanceof Error ? error.message : String(error), ...causes]
    .join(" <- ")
    .replace(/[\r\n\0]+/gu, " ")
    .slice(0, limit);
  const code = (error as { code?: unknown } | null)?.code;
  // A bounded failure code names which guard ended the effect, such as a revalidation abort.
  const suffix =
    typeof code === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(code) ? ` [${code}]` : "";
  return `${error instanceof Error ? error.name : "unknown"}: ${message}${suffix}`;
}
