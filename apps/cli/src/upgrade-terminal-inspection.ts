import { createHash } from "node:crypto";

import { heldTerminalIntegrationReason } from "./held-effect-debt.js";
import {
  planTerminalIntegrationStage,
  type PreparedTerminalIntegration,
} from "./terminal-integration-stage.js";
import type { TerminalIntegrationStage } from "./upgrade-stage-inspection.js";
import type { StageDisposition } from "./upgrade-stage-policy.js";

/**
 * What a failed verification holds: the exact provider hook bytes the plan writes, or the plan
 * itself when only the generated runtime changes. The plan ID and approval hash also bind the
 * generated runtime and the latest application event, which the failed apply can advance, so
 * either alone would let an upgrade retry the same hook bytes.
 */
export function terminalIntegrationHoldSubject(plan: {
  planId: string;
  operations: ReadonlyArray<{ path: string; ownership?: string; desiredHash?: string }>;
}): string {
  const hooks = plan.operations
    .filter((operation) => operation.ownership === "user")
    .map((operation) => `${operation.path}\0${operation.desiredHash ?? ""}`)
    .sort();
  return hooks.length === 0
    ? plan.planId
    : `hooks:${createHash("sha256").update(hooks.join("\n")).digest("hex")}`;
}

/**
 * The terminal integration stage of `lervo upgrade`: generated runtime updates, and provider hook
 * merges that are backed up, applied, verified, and restored on failure (ADR-0561).
 */
export async function inspectTerminalIntegration(root: string): Promise<{
  stage: TerminalIntegrationStage;
  prepared: PreparedTerminalIntegration;
}> {
  const prepared = await planTerminalIntegrationStage(root);
  const { plan } = prepared;
  // ADR-0561: an owner restore holds the provider hook merge; a failed verification holds this
  // exact plan, so an upgrade never loops writing, restoring, and backing up again.
  const held =
    plan.status === "ready"
      ? await heldTerminalIntegrationReason(root, terminalIntegrationHoldSubject(plan)).then(
          (reason) => (reason === "owner_restored" && plan.approvalHash === null ? null : reason),
        )
      : null;
  const disposition: StageDisposition =
    held !== null
      ? "lervo_debt"
      : plan.status === "ready"
        ? "safe_apply"
        : plan.status === "blocked"
          ? "blocked"
          : "current";
  return {
    stage: {
      disposition,
      planId: plan.status === "current" ? null : plan.planId,
      status: plan.status,
      reason:
        held !== null
          ? held
          : plan.status === "ready"
            ? plan.approvalHash === null
              ? "generated_runtime_only"
              : "provider_hooks_backed_up_and_verified"
            : plan.status === "blocked"
              ? "provider_configuration_blocked"
              : "terminal_integration_current",
      blockers: plan.blockers.map((item) => ({
        code: item.code,
        path: item.path,
        message: `${item.provider} terminal integration is blocked by ${item.code}.`,
      })),
    },
    prepared,
  };
}
