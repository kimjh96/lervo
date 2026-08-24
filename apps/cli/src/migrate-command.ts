import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  applyIdentityMigration,
  createIdentityMigrationPlan,
  type IdentityMigrationPlan,
} from "@lervo/identity-migration";

import type { CliIo } from "./types.js";
import { runKnowledgeMigration } from "./knowledge-command.js";

export const migrateUsage =
  "  lervo migrate identity [--root <path>] [--apply <plan-id>] [--json]\n  lervo migrate knowledge [--root <path>] [--continuation-source <relative-markdown-path>] [--provider <codex|claude>|--candidate <candidate-id>] [--model <model>] [--executable <path>] [--timeout-ms <ms>] [--apply <plan-id> --approve-item <operation-id>=<approval-hash>] [--approve-item ...] [--json]";

export function formatIdentityMigrationPlan(plan: IdentityMigrationPlan): string {
  const lines = [
    `Identity migration target: ${plan.repositoryRoot}`,
    `Plan ID: ${plan.planId}`,
    `Plan status: ${plan.status === "ready" ? "ready to apply" : "blocked"}`,
  ];
  if (plan.status === "ready") {
    lines.push(
      `Events to preserve: ${plan.preservedEventCount}`,
      `CAS objects verified: ${plan.verifiedCasObjectCount}`,
      ...(plan.documentDisposition === "archive_previous_metadata"
        ? ["Document metadata using the previous marker will be archived byte-for-byte and the active registry will remain empty."]
        : []),
      "No files have been changed.",
      `Run again with --apply ${plan.planId} to apply this plan.`,
    );
  } else {
    for (const item of plan.blockers) lines.push(`  review required [${item.code}] ${item.message}`);
  }
  return `${lines.join("\n")}\n`;
}

export async function runMigrateCommand(args: string[], io: CliIo): Promise<number> {
  if (args[0] === "knowledge") {
    return runKnowledgeMigration({ args: args.slice(1), io, mode: "migrate" });
  }
  if (args[0] !== "identity") {
    io.stderr(`Specify a supported migration type.\n${migrateUsage}\n`);
    return 1;
  }
  let values: { root?: string; apply?: string; json?: boolean; help?: boolean };
  try {
    const parsed = parseArgs({
      args: args.slice(1),
      strict: true,
      allowPositionals: false,
      options: {
        root: { type: "string" },
        apply: { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
    values = parsed.values;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${migrateUsage}\n`);
    return 1;
  }
  if (values.help) {
    io.stdout(`${migrateUsage}\n`);
    return 0;
  }

  try {
    const plan = await createIdentityMigrationPlan(resolve(io.cwd, values.root ?? "."));
    if (values.apply === undefined) {
      io.stdout(values.json ? `${JSON.stringify(plan, null, 2)}\n` : formatIdentityMigrationPlan(plan));
      return plan.status === "ready" ? 0 : 1;
    }
    if (values.apply !== plan.planId) {
      io.stderr("The requested plan ID does not match the current read-only plan. Review the plan again.\n");
      return 1;
    }
    const receipt = await applyIdentityMigration(plan);
    io.stdout(
      values.json
        ? `${JSON.stringify(receipt, null, 2)}\n`
        : `Identity migration completed. projectId: ${receipt.projectId}\nEvents preserved: ${receipt.preservedEventCount}\nCAS objects verified: ${receipt.verifiedCasObjectCount}\n${receipt.documentArchivePath === null ? "" : `Previous document metadata archive: ${receipt.documentArchivePath}\n`}`,
    );
    return 0;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
