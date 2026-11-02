import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { loadProjectManifest } from "@lervo/project";
import {
  applySkillAuthorizationPlan,
  createSkillAuthorizationPlan,
  parseSkillAuthorizationPlan,
} from "@lervo/skills";

import { effectBackupUndoCommand, sealEffectBackup, takeEffectBackup } from "./effect-backup.js";
import type { CliIo } from "./types.js";

/**
 * Records a named reviewer's authorization of one project skill (ADR-0561). `--apply` plans and
 * applies in one run, or applies a saved plan from `--from`; the plan ID binds the exact manifest
 * internally, so a skill that changed after planning is refused. The manifest is backed up first
 * and `lervo state restore` undoes the authorization.
 */
export async function runSkillAuthorizationCommand(args: string[], io: CliIo): Promise<number> {
  const parsed = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      skill: { type: "string" },
      reviewer: { type: "string" },
      from: { type: "string" },
      apply: { type: "boolean" },
      root: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (parsed.values.help) {
    io.stdout(
      "  lervo capability authorize-skill --skill <skill-id> --reviewer <id> [--apply] [--root <path>] [--json]\n" +
        "  lervo capability authorize-skill --from <plan-json> --apply [--root <path>] [--json]\n",
    );
    return 0;
  }
  const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
  const project = await loadProjectManifest(repositoryRoot);
  const fromSaved = parsed.values.from !== undefined;
  if (
    fromSaved
      ? parsed.values.apply !== true ||
        parsed.values.skill !== undefined ||
        parsed.values.reviewer !== undefined
      : parsed.values.skill === undefined || parsed.values.reviewer === undefined
  )
    throw new Error(
      "Skill authorization takes --skill and --reviewer, or --from with --apply for a saved plan.",
    );
  const plan = fromSaved
    ? parseSkillAuthorizationPlan(
        JSON.parse(await readFile(resolve(io.cwd, parsed.values.from!), "utf8")),
      )
    : await createSkillAuthorizationPlan({
        repositoryRoot,
        projectId: project.projectId,
        skillId: parsed.values.skill!,
        reviewerId: parsed.values.reviewer!,
        reviewedAt: new Date().toISOString(),
      });
  if (!parsed.values.apply) {
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify(plan, null, 2)}\n`
        : `Project skill authorization ${plan.planId}: ${plan.skillId}@${plan.version}; re-run with --apply to authorize it.\n`,
    );
    return 0;
  }
  if (resolve(plan.repositoryRoot) !== repositoryRoot || plan.projectId !== project.projectId)
    throw new Error("The skill authorization plan belongs to another repository or project.");
  const backup = await takeEffectBackup({
    repositoryRoot,
    effect: "skill_authorization",
    reason: `Authorized ${plan.skillId}@${plan.version} for project execution.`,
    files: [resolve(repositoryRoot, plan.manifestPath)],
  });
  const receipt = await applySkillAuthorizationPlan({
    plan,
    approval: plan.planId,
    appliedAt: new Date().toISOString(),
  });
  await sealEffectBackup(repositoryRoot, backup);
  const undo = effectBackupUndoCommand(backup.backupId);
  io.stdout(
    parsed.values.json
      ? `${JSON.stringify({ ...receipt, undo }, null, 2)}\n`
      : `Authorized ${receipt.skillId}@${receipt.version} for project execution (${receipt.status}).\nUndo: ${undo}\n`,
  );
  return 0;
}
