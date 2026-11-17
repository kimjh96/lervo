import { classifyRepositoryFailure } from "./host-follow-policy.js";
import type { HostFollowRepositoryResult, RepositoryUpgradeOutcome } from "./host-follow-state.js";
import type {
  RepositoryUpgradeInvocation,
  RepositoryUpgradeRunner,
} from "./host-repository-upgrade-runner.js";

/** The deploy skill's bound: a plan that keeps changing stops after five rounds. */
export const REPOSITORY_UPGRADE_ROUNDS = 5;

/** A repository's result before the follower schedules its retry. */
export type RepositoryPassEntry = Omit<HostFollowRepositoryResult, "attempts" | "nextAttemptAt">;

const outcomeRank: Record<RepositoryUpgradeOutcome, number> = {
  current: 0,
  blocked: 1,
  failed: 2,
  host_failure: 3,
};

type Failure = Exclude<RepositoryUpgradeInvocation, { kind: "result" | "interrupted" }>;

function failureCode(invocation: Failure): string {
  if (invocation.kind === "failed") return invocation.code;
  return invocation.kind === "timed_out"
    ? "host_follow_repository_upgrade_timeout"
    : "host_follow_repository_upgrade_unreadable";
}

export interface RepositoryPassOptions {
  run: RepositoryUpgradeRunner;
  signal?: AbortSignal | undefined;
  now?: () => number;
  /** Plan ids of repositories left blocked; an unchanged plan is not applied again. */
  blockedPlanIds?: ReadonlyMap<string, string>;
}

/**
 * ADR-0575, the product form of the deploy skill's `upgrade-all.sh`: plan, apply that exact plan
 * by its id, apply `--safe` when a background cycle changed the plan (`upgrade_plan_changed`) or
 * the plan is not `ready`, and repeat for at most five rounds until the repository is current. A
 * failed apply of a `ready` plan goes on to the next round, as the script does. A host-failure
 * code is believed only the second time: Node readiness can time out for reasons of the moment,
 * and the Node stage restores its previous service before it reports, so one more round is safe.
 */
async function upgradeRepository(
  repositoryRoot: string,
  options: RepositoryPassOptions,
): Promise<RepositoryPassEntry | "interrupted"> {
  const now = options.now ?? Date.now;
  const started = now();
  const entry: RepositoryPassEntry = {
    repositoryRoot,
    outcome: "failed",
    status: null,
    code: null,
    rounds: 0,
    appliedStages: [],
    pendingStages: [],
    planId: null,
    waitMs: null,
    applyMs: null,
    elapsedMs: 0,
  };
  const finish = (outcome: RepositoryUpgradeOutcome, code: string | null) => {
    entry.outcome = outcome;
    entry.code = code;
    entry.elapsedMs = now() - started;
    return entry;
  };
  const run = (args: string[]) => options.run(args, options.signal);
  const base = ["upgrade", "--root", repositoryRoot];
  let hostFailureSeen = false;
  let lastCode: string | null = null;
  for (let round = 1; round <= REPOSITORY_UPGRADE_ROUNDS; round += 1) {
    if (options.signal?.aborted === true) return "interrupted";
    entry.rounds = round;
    const plan = await run([...base, "--json"]);
    if (plan.kind === "interrupted") return "interrupted";
    if (plan.kind !== "result") {
      const code = failureCode(plan);
      if (classifyRepositoryFailure(code) === "host_failure" && !hostFailureSeen) {
        hostFailureSeen = true;
        continue;
      }
      return finish(classifyRepositoryFailure(code), code);
    }
    entry.status = plan.status;
    entry.planId = plan.planId;
    if (plan.status === "current") return finish("current", null);
    if (plan.status === "blocked" && plan.applicableStages.length === 0)
      return finish("blocked", "upgrade_plan_blocked");
    if (
      plan.status !== "ready" &&
      plan.planId !== null &&
      options.blockedPlanIds?.get(repositoryRoot) === plan.planId
    )
      return finish("blocked", "upgrade_plan_unchanged");
    let applied =
      plan.status === "ready" && plan.planId !== null
        ? await run([...base, "--apply", "--approval", plan.planId, "--json"])
        : await run([...base, "--apply", "--safe", "--json"]);
    if (applied.kind === "failed" && applied.code === "upgrade_plan_changed")
      applied = await run([...base, "--apply", "--safe", "--json"]);
    if (applied.kind === "interrupted") return "interrupted";
    if (applied.kind !== "result") {
      const code = failureCode(applied);
      const outcome = classifyRepositoryFailure(code);
      lastCode = code;
      if (outcome === "host_failure" && hostFailureSeen) return finish(outcome, code);
      if (outcome === "host_failure") hostFailureSeen = true;
      else if (outcome === "blocked" || plan.status !== "ready") return finish(outcome, code);
      continue;
    }
    lastCode = null;
    entry.status = applied.status;
    entry.planId = applied.planId;
    entry.appliedStages.push(...applied.appliedStages);
    entry.pendingStages = applied.pendingStages;
    if (applied.timing !== null) {
      entry.waitMs = (entry.waitMs ?? 0) + applied.timing.admissionWaitMs;
      entry.applyMs = (entry.applyMs ?? 0) + applied.timing.applyMs;
    }
    if (applied.status === "current") return finish("current", null);
    if (plan.status !== "ready") return finish("blocked", null);
  }
  if (lastCode !== null) {
    const outcome = classifyRepositoryFailure(lastCode);
    return finish(outcome === "host_failure" ? "failed" : outcome, lastCode);
  }
  return finish(
    entry.status === "blocked" || entry.status === "pending_authority" ? "blocked" : "failed",
    "host_follow_repository_upgrade_unconverged",
  );
}

export interface RepositoryPassResult {
  /** `interrupted` when a stop or an outside signal cut the pass short; nothing is settled then. */
  outcome: RepositoryUpgradeOutcome | "interrupted";
  repositories: RepositoryPassEntry[];
}

/**
 * Upgrades the given repositories one at a time, never concurrently. A host failure stops the
 * pass at once, because the remaining repositories would run the same broken CLI; any other
 * outcome is reported and the pass goes on to the next repository.
 */
export async function runRepositoryPass(
  repositoryRoots: readonly string[],
  options: RepositoryPassOptions,
): Promise<RepositoryPassResult> {
  const repositories: RepositoryPassEntry[] = [];
  let outcome: RepositoryUpgradeOutcome = "current";
  for (const root of repositoryRoots) {
    const result = await upgradeRepository(root, options);
    if (result === "interrupted") return { outcome: "interrupted", repositories };
    repositories.push(result);
    if (outcomeRank[result.outcome] > outcomeRank[outcome]) outcome = result.outcome;
    if (result.outcome === "host_failure") break;
  }
  return { outcome, repositories };
}
