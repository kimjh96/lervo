import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { CommandFailure, writeCommandError } from "./command-error-output.js";
import { foregroundKnowledgeMaterializationSettlement } from "./knowledge-materialization-wait.js";
import type { CliIo, CliServices } from "./types.js";
import { applyRepositoryUpgrade, pendingStages } from "./upgrade-apply.js";
import { formatUpgradePlan, formatUpgradeReceipt } from "./upgrade-format.js";
import {
  createRepositoryUpgradePlan,
  knowledgeStageRefusedByMarker,
  type RepositoryUpgradePlan,
} from "./upgrade-plan.js";
import { recordPresentedUpgradePlan, upgradePlanChangedFailure } from "./upgrade-plan-change.js";
import { upgradeHost } from "./upgrade-host.js";
import { UpgradeStageClock } from "./upgrade-stage-timing.js";
import { withKnowledgeResidentExclusion } from "./upgrade-resident-exclusion.js";

export type { RepositoryUpgradePlan } from "./upgrade-plan.js";

export const upgradeUsage =
  "  lervo upgrade [--root <path>] [--apply (--approval <plan-id> [--approve-role-binding <operation-id>=<sha256> ...] | --safe)] [--json]";

function parseRoleBindingApprovals(
  values: string[] | undefined,
): Array<{ operationId: string; approvalHash: string }> {
  return (values ?? []).map((value) => {
    const match = /^(wrbop_[a-f0-9]{24})=(sha256:[a-f0-9]{64})$/u.exec(value);
    if (match === null)
      throw new Error("--approve-role-binding must use <operation-id>=<sha256-approval-hash>.");
    return { operationId: match[1]!, approvalHash: match[2]! };
  });
}

function assertApplicableUpgrade(initial: RepositoryUpgradePlan): void {
  if (initial.status === "blocked" && initial.applicableStages.length === 0)
    throw new Error(
      "The current repository upgrade plan is blocked and has no independent stage to apply.",
    );
}

/**
 * `--safe` applies the plan it computes inside the exclusive window only when no stage needs
 * an owner approval; otherwise it names every such stage and changes nothing.
 */
function assertSafeUpgrade(initial: RepositoryUpgradePlan): void {
  const approvals = pendingStages(initial).filter(
    (stage) => stage.disposition === "pending_authority",
  );
  if (approvals.length > 0)
    throw new CommandFailure(
      "upgrade_owner_approval_required",
      `The upgrade plan ${initial.planId} has stages that need owner approval, so --safe applies nothing: ${approvals
        .map((stage) => `${stage.stage} (${stage.reason})`)
        .join(", ")}. Review it with \`lervo upgrade\` and apply it with --approval.`,
      {
        currentPlanId: initial.planId,
        stages: approvals.map((stage) => ({ stage: stage.stage, reason: stage.reason })),
      },
    );
  assertApplicableUpgrade(initial);
}

async function assertApprovedUpgrade(
  initial: RepositoryUpgradePlan,
  approval: string | undefined,
  roleBindingApprovals: Array<{ operationId: string; approvalHash: string }>,
): Promise<void> {
  if (approval !== initial.planId) throw await upgradePlanChangedFailure(approval, initial);
  assertApplicableUpgrade(initial);
  for (const approved of roleBindingApprovals) {
    if (
      !initial.stages.workforce.requiredApprovals.some(
        (required) =>
          required.operationId === approved.operationId &&
          required.approvalHash === approved.approvalHash,
      )
    )
      throw new Error("A workforce role-binding approval is not in the approved upgrade plan.");
  }
}

export async function runUpgradeCommand(
  args: string[],
  io: CliIo,
  services: Pick<
    CliServices,
    "knowledgeMaterializationWait" | "knowledgeCycleAdmission" | "upgradeHost"
  > = {},
): Promise<number> {
  let values: {
    root?: string;
    apply?: boolean;
    approval?: string;
    safe?: boolean;
    "approve-role-binding"?: string[];
    json?: boolean;
    help?: boolean;
  };
  try {
    values = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      options: {
        root: { type: "string" },
        apply: { type: "boolean" },
        approval: { type: "string" },
        safe: { type: "boolean" },
        "approve-role-binding": { type: "string", multiple: true },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    }).values;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${upgradeUsage}\n`);
    return 1;
  }
  if (values.help) {
    io.stdout(`${upgradeUsage}\n`);
    return 0;
  }
  if (values.safe === true && (values.apply !== true || values.approval !== undefined)) {
    io.stderr(`--safe must be used with --apply and without --approval.\n${upgradeUsage}\n`);
    return 1;
  }
  if (values.safe !== true && (values.apply === true) !== (values.approval !== undefined)) {
    io.stderr(
      `Upgrade apply requires both --apply and --approval, or --apply --safe.\n${upgradeUsage}\n`,
    );
    return 1;
  }
  if (
    (values.apply !== true || values.safe === true) &&
    (values["approve-role-binding"]?.length ?? 0) > 0
  ) {
    io.stderr(`--approve-role-binding must be used with --apply --approval.\n${upgradeUsage}\n`);
    return 1;
  }
  const root = resolve(io.cwd, values.root ?? ".");
  try {
    const roleBindingApprovals = parseRoleBindingApprovals(values["approve-role-binding"]);
    const materialization = foregroundKnowledgeMaterializationSettlement({
      repositoryRoot: root,
      io,
      timing: services.knowledgeMaterializationWait,
    });
    const host = upgradeHost(services.upgradeHost);
    const plan = () =>
      materialization.run(
        () => createRepositoryUpgradePlan(root, host),
        knowledgeStageRefusedByMarker,
      );
    if (!values.apply) {
      const initial = await plan();
      await recordPresentedUpgradePlan(initial);
      io.stdout(values.json ? `${JSON.stringify(initial, null, 2)}\n` : formatUpgradePlan(initial));
      return initial.status === "blocked" ? 1 : 0;
    }
    // The approval is checked against a plan recreated under the exclusion, so no resident
    // change can land between that check and the last applied stage. `--safe` plans inside the
    // same window, so a busy repository cannot move the plan between planning and applying.
    const requestedAt = Date.now();
    let admittedAt = requestedAt;
    const applied = await withKnowledgeResidentExclusion(
      { repositoryRoot: root, io, options: services.knowledgeCycleAdmission },
      async (exclusion) => {
        admittedAt = Date.now();
        const clock = new UpgradeStageClock();
        const initial = await plan();
        if (values.safe === true) assertSafeUpgrade(initial);
        else await assertApprovedUpgrade(initial, values.approval, roleBindingApprovals);
        clock.lap("plan");
        return applyRepositoryUpgrade(
          initial,
          roleBindingApprovals,
          materialization,
          host,
          exclusion,
          clock,
        );
      },
    );
    const receipt = {
      ...applied,
      timing: { admissionWaitMs: admittedAt - requestedAt, applyMs: Date.now() - admittedAt },
    };
    io.stdout(
      values.json ? `${JSON.stringify(receipt, null, 2)}\n` : formatUpgradeReceipt(receipt),
    );
    return receipt.status === "blocked" ? 1 : 0;
  } catch (error) {
    writeCommandError(io, error, {
      json: values.json === true,
      prefix: `Repository upgrade failed${
        error !== null &&
        typeof error === "object" &&
        "code" in error &&
        typeof error.code === "string"
          ? ` (${error.code})`
          : ""
      }: `,
    });
    return 1;
  }
}
