import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { withRepositoryKnowledgeScanReuse } from "@lervo/repository-knowledge";

import { writeCommandError } from "./command-error-output.js";
import { foregroundKnowledgeMaterializationSettlement } from "./knowledge-materialization-wait.js";
import { hasRemovedOption, REMOVED_UPGRADE_APPROVAL } from "./removed-approval-options.js";
import type { CliIo, CliServices } from "./types.js";
import { applyRepositoryUpgrade } from "./upgrade-apply.js";
import { formatUpgradePlan, formatUpgradeReceipt } from "./upgrade-format.js";
import {
  createRepositoryUpgradePlan,
  knowledgeStageRefusedByMarker,
  type RepositoryUpgradePlan,
} from "./upgrade-plan.js";
import { upgradeHost } from "./upgrade-host.js";
import { UpgradeStageClock } from "./upgrade-stage-timing.js";
import { withKnowledgeResidentExclusion } from "./upgrade-resident-exclusion.js";

export type { RepositoryUpgradePlan } from "./upgrade-plan.js";

export const upgradeUsage = "  lervo upgrade [--root <path>] [--apply] [--json]";

function assertApplicableUpgrade(current: RepositoryUpgradePlan): void {
  if (current.status === "blocked" && current.applicableStages.length === 0)
    throw new Error(
      "The current repository upgrade plan is blocked and has no independent stage to apply.",
    );
}

type UpgradeCommandServices = Pick<
  CliServices,
  "knowledgeMaterializationWait" | "knowledgeCycleAdmission" | "upgradeHost"
> &
  Partial<Pick<CliServices, "crossCheckPlan">>;

/**
 * ADR-0582: every plan, inspection, and lint of one command reuses one repository scan while its
 * fingerprint holds, and scans again after any change to what it read.
 */
export function runUpgradeCommand(
  args: string[],
  io: CliIo,
  services: UpgradeCommandServices = {},
): Promise<number> {
  return withRepositoryKnowledgeScanReuse(() => runRepositoryUpgradeCommand(args, io, services));
}

/**
 * `lervo upgrade` prints the plan; `--apply` plans again inside the exclusive window and applies
 * that plan (ADR-0487, ADR-0561). No stage waits for an owner approval: each stage plans again and
 * compares before it writes, so the stale-plan guard is internal instead of an echoed plan ID.
 */
async function runRepositoryUpgradeCommand(
  args: string[],
  io: CliIo,
  services: UpgradeCommandServices,
): Promise<number> {
  if (hasRemovedOption(args, "approval", "approve-role-binding")) {
    io.stderr(`${REMOVED_UPGRADE_APPROVAL}\n${upgradeUsage}\n`);
    return 1;
  }
  let values: { root?: string; apply?: boolean; safe?: boolean; json?: boolean; help?: boolean };
  try {
    values = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      options: {
        root: { type: "string" },
        apply: { type: "boolean" },
        // ADR-0487's one-window apply is now what --apply does; --safe stays accepted.
        safe: { type: "boolean" },
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
  if (values.safe === true && values.apply !== true) {
    io.stderr(`--safe must be used with --apply.\n${upgradeUsage}\n`);
    return 1;
  }
  const root = resolve(io.cwd, values.root ?? ".");
  try {
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
      io.stdout(values.json ? `${JSON.stringify(initial, null, 2)}\n` : formatUpgradePlan(initial));
      return initial.status === "blocked" ? 1 : 0;
    }
    // The plan is created under the exclusion, so no resident change can land between planning
    // and the last applied stage, and a busy repository cannot move it in between.
    const requestedAt = Date.now();
    let admittedAt = requestedAt;
    const applied = await withKnowledgeResidentExclusion(
      { repositoryRoot: root, io, options: services.knowledgeCycleAdmission },
      async (exclusion) => {
        admittedAt = Date.now();
        const clock = new UpgradeStageClock();
        const current = await plan();
        assertApplicableUpgrade(current);
        clock.lap("plan");
        return applyRepositoryUpgrade(current, materialization, host, exclusion, clock, {
          ...(services.crossCheckPlan === undefined
            ? {}
            : { crossCheckPlan: services.crossCheckPlan }),
        });
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
