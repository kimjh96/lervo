import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { openReadOnlyProjectStorage } from "@lervo/project-storage";
import {
  planProjectConvergenceArtifactRetention,
  type CasRetentionPlan,
} from "@lervo/repository-knowledge-runtime";

import type { CliIo } from "./types.js";

export const stateCasRetentionUsage = "  lervo state cas-retention --plan [--root <path>] [--json]";

function gigabytes(bytes: number): string {
  return `${(bytes / 1e9).toFixed(2)} GB`;
}

function renderPlan(plan: CasRetentionPlan): string {
  if (plan.status === "unavailable") return `CAS retention plan unavailable: ${plan.failure}.\n`;
  const reasons = Object.entries(plan.collectable.byReason)
    .map(([reason, count]) => `  ${reason}: ${count.objects} objects, ${gigabytes(count.bytes)}`)
    .join("\n");
  return [
    `CAS: ${plan.casObjects} objects, ${gigabytes(plan.casBytes)}.`,
    `Candidates past grace: ${plan.candidates.objects} objects, ${gigabytes(plan.candidates.bytes)}.`,
    `Retained: ${plan.retained.objects} objects, ${gigabytes(plan.retained.bytes)}.`,
    `Collectable: ${plan.collectable.objects} objects, ${gigabytes(plan.collectable.bytes)}.`,
    reasons,
    "Nothing was deleted.",
    "",
  ].join("\n");
}

/** ADR-0585: estimates one retention pass from a read-only store; it never deletes or records. */
export async function runStateCasRetentionCommand(args: string[], io: CliIo): Promise<number> {
  try {
    const parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      options: {
        plan: { type: "boolean" },
        root: { type: "string" },
        json: { type: "boolean" },
      },
    });
    if (!parsed.values.plan) throw new Error("Specify --plan; retention runs only in the worker.");
    const storage = await openReadOnlyProjectStorage(resolve(io.cwd, parsed.values.root ?? "."));
    let plan: CasRetentionPlan;
    try {
      plan = await planProjectConvergenceArtifactRetention(storage);
    } finally {
      await storage.close();
    }
    io.stdout(parsed.values.json ? `${JSON.stringify(plan, null, 2)}\n` : renderPlan(plan));
    return plan.status === "planned" ? 0 : 1;
  } catch (error) {
    io.stderr(
      `${error instanceof Error ? error.message : String(error)}\n${stateCasRetentionUsage}\n`,
    );
    return 1;
  }
}
