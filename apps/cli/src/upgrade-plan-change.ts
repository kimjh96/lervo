import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { resolveProjectPaths } from "@lervo/project";

import { CommandFailure } from "./command-error-output.js";
import type { RepositoryUpgradePlan } from "./upgrade-plan.js";

/** One overwritten projection: the last plan `lervo upgrade` presented for approval. */
function presentedPlanPath(repositoryRoot: string): string {
  return resolve(resolveProjectPaths(repositoryRoot).state, "upgrade", "presented-plan.json");
}

/** Best effort: a missing record only makes a later change explanation less specific. */
export async function recordPresentedUpgradePlan(plan: RepositoryUpgradePlan): Promise<void> {
  const path = presentedPlanPath(plan.repositoryRoot);
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(`${path}.next`, `${JSON.stringify(plan)}\n`, { mode: 0o600 });
    await rename(`${path}.next`, path);
  } catch {
    // The plan output itself is the canonical approval surface.
  }
}

async function presentedPlan(
  repositoryRoot: string,
  planId: string,
): Promise<RepositoryUpgradePlan | null> {
  try {
    const value = JSON.parse(
      await readFile(presentedPlanPath(repositoryRoot), "utf8"),
    ) as RepositoryUpgradePlan;
    return value?.planId === planId ? value : null;
  } catch {
    return null;
  }
}

function stageChange(name: string, before: unknown, after: unknown): string | null {
  if (JSON.stringify(before) === JSON.stringify(after)) return null;
  const left = (before ?? {}) as { disposition?: unknown; planId?: unknown; reason?: unknown };
  const right = (after ?? {}) as { disposition?: unknown; planId?: unknown; reason?: unknown };
  const facts = [
    left.disposition !== right.disposition
      ? `disposition ${String(left.disposition)} -> ${String(right.disposition)}`
      : null,
    left.planId !== right.planId
      ? `plan ${String(left.planId ?? "none")} -> ${String(right.planId ?? "none")}`
      : null,
    left.reason !== right.reason
      ? `reason ${String(left.reason)} -> ${String(right.reason)}`
      : null,
  ].filter((fact): fact is string => fact !== null);
  return `${name} (${facts.length === 0 ? "observed inputs changed" : facts.join(", ")})`;
}

/** Names what differs between the approved and current plans, stage by stage. */
export function upgradePlanChanges(
  approved: RepositoryUpgradePlan,
  current: RepositoryUpgradePlan,
): string[] {
  const changes: string[] = [];
  if (
    approved.cli.version !== current.cli.version ||
    approved.cli.buildHash !== current.cli.buildHash
  )
    changes.push("cli (a different Lervo CLI build is running)");
  if (approved.projectId !== current.projectId) changes.push("project identity");
  if (JSON.stringify(approved.policy) !== JSON.stringify(current.policy))
    changes.push("upgrade policy");
  const names = new Set([...Object.keys(approved.stages), ...Object.keys(current.stages)]);
  for (const name of names) {
    const change = stageChange(
      name,
      (approved.stages as Record<string, unknown>)[name],
      (current.stages as Record<string, unknown>)[name],
    );
    if (change !== null) changes.push(change);
  }
  return changes;
}

/**
 * The refusal for an approval that no longer matches. It names the current plan ID and, when
 * the approved plan was presented on this checkout, the stages or inputs that changed.
 */
export async function upgradePlanChangedFailure(
  approval: string | undefined,
  current: RepositoryUpgradePlan,
): Promise<CommandFailure> {
  const approved =
    approval === undefined ? null : await presentedPlan(current.repositoryRoot, approval);
  const changes = approved === null ? [] : upgradePlanChanges(approved, current);
  const reason =
    approved === null
      ? "The approved plan was not presented on this checkout, so the change cannot be itemized."
      : changes.length === 0
        ? "Only the plan identity changed."
        : `Changed: ${changes.join("; ")}.`;
  return new CommandFailure(
    "upgrade_plan_changed",
    `--approval must equal the exact current repository upgrade plan ID. The current plan is ${current.planId}. ${reason} Review it with \`lervo upgrade\`, or use \`lervo upgrade --apply --safe\` when no stage needs owner approval.`,
    { approvedPlanId: approval ?? null, currentPlanId: current.planId, changes },
  );
}
