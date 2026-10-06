import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { writeCommandError } from "./command-error-output.js";
import { foregroundKnowledgeMaterializationSettlement } from "./knowledge-materialization-wait.js";
import type { CliIo, CliServices } from "./types.js";
import { applyRepositoryUpgrade } from "./upgrade-apply.js";
import { formatUpgradePlan, formatUpgradeReceipt } from "./upgrade-format.js";
import {
  createRepositoryUpgradePlan,
  knowledgeStageRefusedByMarker,
  type RepositoryUpgradePlan,
} from "./upgrade-plan.js";
import { withKnowledgeResidentExclusion } from "./upgrade-resident-exclusion.js";

export type { RepositoryUpgradePlan } from "./upgrade-plan.js";

export const upgradeUsage =
  "  lervo upgrade [--root <path>] [--apply --approval <plan-id> [--approve-role-binding <operation-id>=<sha256> ...]] [--json]";

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

function assertApprovedUpgrade(
  initial: RepositoryUpgradePlan,
  approval: string | undefined,
  roleBindingApprovals: Array<{ operationId: string; approvalHash: string }>,
): void {
  if (approval !== initial.planId)
    throw new Error("--approval must equal the exact current repository upgrade plan ID.");
  if (initial.status === "blocked" && initial.applicableStages.length === 0)
    throw new Error(
      "The current repository upgrade plan is blocked and has no independent stage to apply.",
    );
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
  services: Pick<CliServices, "knowledgeMaterializationWait" | "knowledgeCycleAdmission"> = {},
): Promise<number> {
  let values: {
    root?: string;
    apply?: boolean;
    approval?: string;
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
  if ((values.apply === true) !== (values.approval !== undefined)) {
    io.stderr(`Upgrade apply requires both --apply and --approval.\n${upgradeUsage}\n`);
    return 1;
  }
  if (values.apply !== true && (values["approve-role-binding"]?.length ?? 0) > 0) {
    io.stderr(`--approve-role-binding must be used with --apply.\n${upgradeUsage}\n`);
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
    const plan = () =>
      materialization.run(() => createRepositoryUpgradePlan(root), knowledgeStageRefusedByMarker);
    if (!values.apply) {
      const initial = await plan();
      io.stdout(values.json ? `${JSON.stringify(initial, null, 2)}\n` : formatUpgradePlan(initial));
      return initial.status === "blocked" ? 1 : 0;
    }
    // The approval is checked against a plan recreated under the exclusion, so no resident
    // change can land between that check and the last applied stage.
    const receipt = await withKnowledgeResidentExclusion(
      { repositoryRoot: root, io, options: services.knowledgeCycleAdmission },
      async () => {
        const initial = await plan();
        assertApprovedUpgrade(initial, values.approval, roleBindingApprovals);
        return applyRepositoryUpgrade(initial, roleBindingApprovals, materialization);
      },
    );
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
