import type { OutcomeSupervisionReportV1 } from "@lervo/application-contract";

import { boundedHealthReasonCodes } from "./health-contract.js";

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
