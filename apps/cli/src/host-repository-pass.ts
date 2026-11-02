import { classifyRepositoryFailure, LERVO_DEBT_CODE } from "./host-follow-policy.js";
import type {
  HostFollowRepositoryResult,
  HostFollowStageTiming,
  RepositoryUpgradeOutcome,
} from "./host-follow-state.js";
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
  /**
   * ADR-0589: asked between repositories of a pass that installs no release. True stops the pass
   * at that boundary, so a newer release does not wait for the remaining repositories.
   */
  yieldToRelease?: () => Promise<boolean>;
}

/**
 * ADR-0575, the product form of the deploy skill's `upgrade-all.sh`: plan, then `--apply`, which
 * plans again inside the exclusive window and applies that plan (ADR-0561), and repeat for at most
 * five rounds until the repository is current. No stage waits for an owner approval; a stage
 * Lervo holds itself (`lervo_debt`) is reported as a block and rechecked like one. A failed apply
 * of a `ready` plan goes on to the next round, as the script does. A host-failure code is believed
 * only the second time: Node readiness can time out for reasons of the moment, and the Node stage
 * restores its previous service before it reports, so one more round is safe.
 */
async function upgradeRepository(
  repositoryRoot: string,
  options: RepositoryPassOptions,
): Promise<RepositoryPassEntry | "interrupted"> {
  const now = options.now ?? Date.now;
  const started = now();
  const stageTimings: HostFollowStageTiming[] = [];
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
    stageTimings,
  };
  const finish = (outcome: RepositoryUpgradeOutcome, code: string | null) => {
    entry.outcome = outcome;
    entry.code = code;
    entry.elapsedMs = now() - started;
    return entry;
  };
  const run = (args: string[]) => options.run(args, options.signal);
  // ADR-0589: an apply that leaves no receipt parts is one part of its own, so its time shows.
  const apply = async (round: number, args: string[]) => {
    const applyStarted = now();
    const invocation = await run(args);
    if (
      invocation.kind !== "interrupted" &&
      (invocation.kind !== "result" || invocation.stageTimings === undefined)
    )
      stageTimings.push({ round, stage: "apply_command", ms: now() - applyStarted });
    return invocation;
  };
  const base = ["upgrade", "--root", repositoryRoot];
  let hostFailureSeen = false;
  let lastCode: string | null = null;
  for (let round = 1; round <= REPOSITORY_UPGRADE_ROUNDS; round += 1) {
    if (options.signal?.aborted === true) return "interrupted";
    entry.rounds = round;
    const planStarted = now();
    const plan = await run([...base, "--json"]);
    if (plan.kind === "interrupted") return "interrupted";
    stageTimings.push({ round, stage: "plan_command", ms: now() - planStarted });
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
    // ADR-0561: Lervo holds these stages itself and retries them on its own backoff.
    if (plan.status === "lervo_debt") {
      entry.pendingStages = plan.lervoDebtStages ?? [];
      return finish("blocked", LERVO_DEBT_CODE);
    }
    if (plan.status === "blocked" && plan.applicableStages.length === 0)
      return finish("blocked", "upgrade_plan_blocked");
    if (
      plan.status !== "ready" &&
      plan.planId !== null &&
      options.blockedPlanIds?.get(repositoryRoot) === plan.planId
    )
      return finish("blocked", "upgrade_plan_unchanged");
    const applied = await apply(round, [...base, "--apply", "--json"]);
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
    for (const timing of applied.stageTimings ?? []) stageTimings.push({ round, ...timing });
    entry.pendingStages = applied.pendingStages;
    if (applied.timing !== null) {
      entry.waitMs = (entry.waitMs ?? 0) + applied.timing.admissionWaitMs;
      entry.applyMs = (entry.applyMs ?? 0) + applied.timing.applyMs;
    }
    if (applied.status === "current") return finish("current", null);
    if (applied.status === "lervo_debt") return finish("blocked", LERVO_DEBT_CODE);
    if (plan.status !== "ready") return finish("blocked", null);
  }
  if (lastCode !== null) {
    const outcome = classifyRepositoryFailure(lastCode);
    return finish(outcome === "host_failure" ? "failed" : outcome, lastCode);
  }
  return finish(
    entry.status === "blocked" ? "blocked" : "failed",
    "host_follow_repository_upgrade_unconverged",
  );
}

export interface RepositoryPassResult {
  /** `interrupted` when a stop or an outside signal cut the pass short; nothing is settled then. */
  outcome: RepositoryUpgradeOutcome | "interrupted";
  repositories: RepositoryPassEntry[];
  /** ADR-0589: the repositories a newer release stopped the pass before; absent otherwise. */
  yieldedRoots?: string[];
}

/**
 * Upgrades the given repositories one at a time, never concurrently. A host failure stops the
 * pass at once, because the remaining repositories would run the same broken CLI; any other
 * outcome is reported and the pass goes on to the next repository, unless `yieldToRelease`
 * stops it at that boundary.
 */
export async function runRepositoryPass(
  repositoryRoots: readonly string[],
  options: RepositoryPassOptions,
): Promise<RepositoryPassResult> {
  const repositories: RepositoryPassEntry[] = [];
  let outcome: RepositoryUpgradeOutcome = "current";
  for (const [index, root] of repositoryRoots.entries()) {
    if (index > 0 && options.yieldToRelease !== undefined && (await options.yieldToRelease()))
      return { outcome, repositories, yieldedRoots: repositoryRoots.slice(index) };
    const result = await upgradeRepository(root, options);
    if (result === "interrupted") return { outcome: "interrupted", repositories };
    repositories.push(result);
    if (outcomeRank[result.outcome] > outcomeRank[outcome]) outcome = result.outcome;
    if (result.outcome === "host_failure") break;
  }
  return { outcome, repositories };
}
