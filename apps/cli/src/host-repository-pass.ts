import { classifyRepositoryFailure } from "./host-follow-policy.js";
import type { HostFollowRepositoryResult, RepositoryUpgradeOutcome } from "./host-follow-state.js";
import type {
  RepositoryUpgradeInvocation,
  RepositoryUpgradeRunner,
} from "./host-repository-upgrade-runner.js";

/** The deploy skill's bound: a plan that keeps changing stops after five rounds. */
export const REPOSITORY_UPGRADE_ROUNDS = 5;

const outcomeRank: Record<RepositoryUpgradeOutcome, number> = {
  current: 0,
  blocked: 1,
  failed: 2,
  host_failure: 3,
};

function failureCode(invocation: Exclude<RepositoryUpgradeInvocation, { kind: "result" }>) {
  if (invocation.kind === "failed") return invocation.code;
  return invocation.kind === "timed_out"
    ? "host_follow_repository_upgrade_timeout"
    : "host_follow_repository_upgrade_unreadable";
}

/**
 * ADR-0575, the product form of the deploy skill's `upgrade-all.sh`: plan, apply that exact plan
 * by its id, apply `--safe` when a background cycle changed the plan (`upgrade_plan_changed`) or
 * the plan is not `ready`, and repeat for at most five rounds until the repository is current.
 */
async function upgradeRepository(
  repositoryRoot: string,
  run: RepositoryUpgradeRunner,
): Promise<HostFollowRepositoryResult> {
  const appliedStages: string[] = [];
  let pendingStages: string[] = [];
  const finish = (
    rounds: number,
    outcome: RepositoryUpgradeOutcome,
    status: string | null,
    code: string | null,
  ): HostFollowRepositoryResult => ({
    repositoryRoot,
    outcome,
    status,
    code,
    rounds,
    appliedStages,
    pendingStages,
  });
  const base = ["upgrade", "--root", repositoryRoot];
  let status: string | null = null;
  for (let round = 1; round <= REPOSITORY_UPGRADE_ROUNDS; round += 1) {
    const plan = await run([...base, "--json"]);
    if (plan.kind !== "result") {
      const code = failureCode(plan);
      return finish(round, classifyRepositoryFailure(code), status, code);
    }
    status = plan.status;
    if (plan.status === "current") return finish(round, "current", status, null);
    if (plan.status === "blocked" && plan.applicableStages.length === 0)
      return finish(round, "blocked", status, "upgrade_plan_blocked");
    let applied =
      plan.status === "ready" && plan.planId !== null
        ? await run([...base, "--apply", "--approval", plan.planId, "--json"])
        : await run([...base, "--apply", "--safe", "--json"]);
    if (applied.kind === "failed" && applied.code === "upgrade_plan_changed")
      applied = await run([...base, "--apply", "--safe", "--json"]);
    if (applied.kind !== "result") {
      const code = failureCode(applied);
      return finish(round, classifyRepositoryFailure(code), status, code);
    }
    status = applied.status;
    appliedStages.push(...applied.appliedStages);
    pendingStages = applied.pendingStages;
    if (applied.status === "current") return finish(round, "current", status, null);
    if (plan.status !== "ready") return finish(round, "blocked", status, null);
  }
  return finish(
    REPOSITORY_UPGRADE_ROUNDS,
    status === "blocked" || status === "pending_authority" ? "blocked" : "failed",
    status,
    "host_follow_repository_upgrade_unconverged",
  );
}

export interface RepositoryPassResult {
  outcome: RepositoryUpgradeOutcome;
  repositories: HostFollowRepositoryResult[];
}

/**
 * Upgrades every registered repository one at a time, never concurrently. A host failure stops
 * the pass at once, because the remaining repositories would run the same broken CLI; any other
 * outcome is reported and the pass goes on to the next repository.
 */
export async function runRepositoryPass(
  repositoryRoots: readonly string[],
  run: RepositoryUpgradeRunner,
): Promise<RepositoryPassResult> {
  const repositories: HostFollowRepositoryResult[] = [];
  let outcome: RepositoryUpgradeOutcome = "current";
  for (const root of repositoryRoots) {
    const result = await upgradeRepository(root, run);
    repositories.push(result);
    if (outcomeRank[result.outcome] > outcomeRank[outcome]) outcome = result.outcome;
    if (result.outcome === "host_failure") break;
  }
  return { outcome, repositories };
}
