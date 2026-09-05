import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { loadProjectManifest } from "@lervo/project";
import {
  applySkillAuthorizationPlan,
  createSkillAuthorizationPlan,
  parseSkillAuthorizationPlan,
} from "@lervo/skills";

import type { CliIo } from "./types.js";

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
      approval: { type: "string" },
      root: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (parsed.values.help) {
    io.stdout(
      "  lervo capability authorize-skill --skill <skill-id> --reviewer <id> [--root <path>] [--json]\n" +
        "  lervo capability authorize-skill --from <plan-json> --apply --approval <plan-id> [--root <path>] [--json]\n",
    );
    return 0;
  }
  const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
  const project = await loadProjectManifest(repositoryRoot);
  if (!parsed.values.apply) {
    if (
      parsed.values.skill === undefined ||
      parsed.values.reviewer === undefined ||
      parsed.values.from !== undefined ||
      parsed.values.approval !== undefined
    )
      throw new Error("Skill authorization planning requires --skill and --reviewer only.");
    const plan = await createSkillAuthorizationPlan({
      repositoryRoot,
      projectId: project.projectId,
      skillId: parsed.values.skill,
      reviewerId: parsed.values.reviewer,
      reviewedAt: new Date().toISOString(),
    });
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify(plan, null, 2)}\n`
        : `Project skill authorization ${plan.planId}: ${plan.skillId}@${plan.version}; re-run with --json to save the exact plan before apply.\n`,
    );
    return 0;
  }
  if (
    parsed.values.from === undefined ||
    parsed.values.approval === undefined ||
    parsed.values.skill !== undefined ||
    parsed.values.reviewer !== undefined
  )
    throw new Error("Skill authorization apply requires --from and --approval only.");
  const plan = parseSkillAuthorizationPlan(
    JSON.parse(await readFile(resolve(io.cwd, parsed.values.from), "utf8")),
  );
  if (resolve(plan.repositoryRoot) !== repositoryRoot || plan.projectId !== project.projectId)
    throw new Error("The skill authorization plan belongs to another repository or project.");
  const receipt = await applySkillAuthorizationPlan({
    plan,
    approval: parsed.values.approval,
    appliedAt: new Date().toISOString(),
  });
  io.stdout(
    parsed.values.json
      ? `${JSON.stringify(receipt, null, 2)}\n`
      : `Authorized ${receipt.skillId}@${receipt.version} for project execution (${receipt.status}).\n`,
  );
  return 0;
}
