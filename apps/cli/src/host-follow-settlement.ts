import { errorCode } from "./command-error-output.js";
import {
  readActivationJournal,
  withHostUpgradeLock,
  type HostActivationRecord,
} from "./host-cli-activation.js";
import type {
  HostFollowCycleDependencies,
  HostFollowStepResult,
} from "./host-follow-cycle-contract.js";
import { FOLLOW_INSTALL_FAILURE_LIMIT, scheduleRepositoryRetry } from "./host-follow-policy.js";
import { pointFollowRuntime, readActiveCli, type ActiveCli } from "./host-follow-runtime.js";
import {
  withFailedTag,
  writeFollowState,
  type HostFollowInFlight,
  type HostFollowPass,
  type HostFollowState,
  type RepositoryUpgradeOutcome,
} from "./host-follow-state.js";
import { reconcilePendingActivations } from "./host-link-activation.js";
import { runRepositoryPass } from "./host-repository-pass.js";
import { rollbackActivation } from "./host-upgrade-rollback.js";

/** Passes cut short by an outside signal, such as the OOM killer, before that counts as a host failure. */
export const FOLLOW_INTERRUPTION_LIMIT = 3;

/**
 * True when this process runs another package than the `lervo` link: the follower then points its
 * runtime link at the active package and must exit, because Node never reloads a running program.
 */
export async function handoverDue(
  dependencies: HostFollowCycleDependencies,
  active: ActiveCli,
): Promise<boolean> {
  if (active.packageRoot === null) return false;
  await pointFollowRuntime(dependencies.upgrade.layout, active.packageRoot);
  const running = await dependencies.runningInstallRoot();
  return running !== null && running !== active.packageRoot;
}

/** The follower's own activation of an intent: the journal record with exactly its id. */
export function activationOfIntent(
  journal: readonly HostActivationRecord[],
  inFlight: HostFollowInFlight,
): HostActivationRecord | undefined {
  return journal.find((record) => record.activationId === inFlight.activationId);
}

const outcomeRank: Record<RepositoryUpgradeOutcome, number> = {
  current: 0,
  blocked: 1,
  failed: 2,
  host_failure: 3,
};

/**
 * Runs `lervo upgrade` on the given repositories with the active CLI and schedules each retry.
 * Null when a stop or an outside signal cut the pass short; nothing is recorded then.
 */
export async function passWithActiveCli(
  dependencies: HostFollowCycleDependencies,
  roots: readonly string[],
  active: ActiveCli,
  previous: HostFollowPass | null,
): Promise<HostFollowPass | null> {
  const blockedPlanIds = new Map(
    (previous?.repositories ?? []).flatMap((repository) =>
      repository.outcome === "blocked" && repository.planId !== null
        ? [[repository.repositoryRoot, repository.planId] as const]
        : [],
    ),
  );
  const raw = await runRepositoryPass(roots, {
    run: dependencies.runRepositoryUpgrade,
    signal: dependencies.signal,
    blockedPlanIds,
  });
  if (raw.outcome === "interrupted") return null;
  const finishedAt = dependencies.upgrade.now();
  return {
    cliTarget: active.target ?? "",
    version: active.version,
    finishedAt: finishedAt.toISOString(),
    outcome: raw.outcome,
    repositories: raw.repositories.map((entry) =>
      scheduleRepositoryRetry(
        entry,
        previous?.repositories.find((item) => item.repositoryRoot === entry.repositoryRoot),
        finishedAt,
      ),
    ),
  };
}

/** Repositories whose retry is due with the CLI the last pass ran. */
export function dueRepositories(state: HostFollowState, active: ActiveCli, now: Date): string[] {
  const pass = state.lastPass;
  if (pass === null || pass.cliTarget !== active.target) return [];
  return pass.repositories
    .filter(
      (repository) =>
        repository.nextAttemptAt !== null && repository.nextAttemptAt <= now.toISOString(),
    )
    .map((repository) => repository.repositoryRoot);
}

/** Tries the due repositories again and merges their results into the last pass. */
export async function retryRepositories(
  dependencies: HostFollowCycleDependencies,
  state: HostFollowState,
  active: ActiveCli,
  roots: readonly string[],
): Promise<HostFollowStepResult> {
  const previous = state.lastPass as HostFollowPass;
  const retried = await passWithActiveCli(dependencies, roots, active, previous);
  if (retried === null) return { state, step: { outcome: "interrupted" } };
  const repositories = previous.repositories.map(
    (repository) =>
      retried.repositories.find((item) => item.repositoryRoot === repository.repositoryRoot) ??
      repository,
  );
  const outcome = repositories.reduce<RepositoryUpgradeOutcome>(
    (worst, repository) =>
      outcomeRank[repository.outcome] > outcomeRank[worst] ? repository.outcome : worst,
    "current",
  );
  const lastPass = { ...previous, finishedAt: retried.finishedAt, outcome, repositories };
  return {
    state: { ...state, lastPass },
    step: { outcome: "repositories_retried", pass: lastPass },
  };
}

/** A pass for a CLI that no follower activation owns: a handover, a manual activation, or a restore. */
export async function upgradeRepositories(
  dependencies: HostFollowCycleDependencies,
  state: HostFollowState,
  active: ActiveCli,
): Promise<HostFollowStepResult> {
  const pass = await passWithActiveCli(
    dependencies,
    await dependencies.listRepositories(),
    active,
    null,
  );
  if (pass === null) return { state, step: { outcome: "interrupted" } };
  return {
    state: { ...state, lastPass: pass },
    step: {
      outcome: "repositories_upgraded",
      pass,
      handover: await handoverDue(dependencies, active),
    },
  };
}

/**
 * Rolls the follower's activation back by id. A held host upgrade lock keeps the intent, so the
 * next cycle tries again; only a rollback ADR-0571 refuses for good ends it. A pass on the
 * restored CLI then converges every repository.
 */
async function rollBack(
  dependencies: HostFollowCycleDependencies,
  initial: HostFollowState,
  inFlight: HostFollowInFlight & { rollback: { code: string } },
): Promise<HostFollowStepResult> {
  const base = { tag: inFlight.tag, activationId: inFlight.activationId };
  // A process that rolled back and died before recording it finds its rollback in the journal;
  // retrying would be refused as superseded and skip the converging pass.
  const done = (await readActivationJournal(dependencies.upgrade.layout)).some(
    (record) =>
      record.kind === "rollback" &&
      record.outcome === "active" &&
      record.rolledBackActivationId === inFlight.activationId,
  );
  try {
    if (!done) await rollbackActivation(inFlight.activationId, true, dependencies.upgrade);
  } catch (error) {
    const code = errorCode(error);
    if (code === "host_upgrade_in_progress")
      return { state: initial, step: { outcome: "rollback_pending", ...base, code } };
    return {
      state: { ...initial, inFlight: null },
      step: { outcome: "rollback_failed", ...base, code },
    };
  }
  let state: HostFollowState = { ...initial, inFlight: null };
  const restored = await readActiveCli(dependencies.upgrade.layout);
  const converged = await passWithActiveCli(
    dependencies,
    await dependencies.listRepositories(),
    restored,
    null,
  );
  // An interrupted converging pass is simply due again: the link names another CLI than lastPass.
  if (converged !== null) state = { ...state, lastPass: converged };
  return {
    state,
    step: {
      outcome: "rolled_back",
      ...base,
      code: inFlight.rollback.code,
      pass: converged,
      handover: await handoverDue(dependencies, restored),
    },
  };
}

/**
 * An intent with no active record of its own: the install never switched, or a crash left a
 * pending record that reconciliation restored. The tag is installed again at the next poll, but an
 * abandoned install counts against it like an installer failure, so a host where something keeps
 * killing the follower in that window marks the tag failed after FOLLOW_INSTALL_FAILURE_LIMIT.
 */
function abandonInstall(
  dependencies: HostFollowCycleDependencies,
  initial: HostFollowState,
  inFlight: HostFollowInFlight,
): HostFollowStepResult {
  const { tag, activationId } = inFlight;
  const code = "host_follow_install_abandoned";
  const count = initial.installFailures?.tag === tag ? initial.installFailures.count + 1 : 1;
  if (count < FOLLOW_INSTALL_FAILURE_LIMIT)
    return {
      state: { ...initial, inFlight: null, installFailures: { tag, count, code } },
      step: { outcome: "install_abandoned", tag, activationId, code },
    };
  return {
    state: withFailedTag(
      { ...initial, inFlight: null, installFailures: null },
      { tag, failedAt: dependencies.upgrade.now().toISOString(), code, activationId: null },
    ),
    step: { outcome: "release_failed", tag, activationId, code },
  };
}

/**
 * ADR-0575: settles the release the follower installed, whichever process does it. The intent is
 * matched to its journal record; a pass with the active CLI then proves it on this host, or a host
 * failure marks the tag failed before the activation is rolled back by id. A stop request leaves
 * the intent as it is, so the next start resumes; a pass cut short by an outside signal is retried
 * and counts as a host failure only after FOLLOW_INTERRUPTION_LIMIT of them.
 */
export async function settleInFlight(
  dependencies: HostFollowCycleDependencies,
  initial: HostFollowState,
  active: ActiveCli,
): Promise<HostFollowStepResult> {
  const { layout } = dependencies.upgrade;
  const inFlight = initial.inFlight as HostFollowInFlight;
  const base = { tag: inFlight.tag, activationId: inFlight.activationId };
  let record = activationOfIntent(await readActivationJournal(layout), inFlight);
  if (record?.outcome === "pending") {
    // A crash between the link switch and the journal settling: ADR-0571 reconciliation restores
    // or abandons it under the host upgrade lock, never leaving switched links unowned.
    try {
      await withHostUpgradeLock(layout, () => reconcilePendingActivations(layout));
    } catch (error) {
      const code = errorCode(error);
      if (code === "host_upgrade_in_progress")
        return { state: initial, step: { outcome: "busy", ...base, code } };
      throw error;
    }
    record = activationOfIntent(await readActivationJournal(layout), inFlight);
  }
  if (record === undefined || (record.outcome !== "active" && inFlight.rollback === null))
    return abandonInstall(dependencies, initial, inFlight);
  let state: HostFollowState = { ...initial, inFlight };
  if (inFlight.rollback !== null)
    return rollBack(dependencies, state, { ...inFlight, rollback: inFlight.rollback });
  const switched = record.links.find((link) => link.name === "lervo")?.current ?? null;
  if (switched !== active.target)
    return {
      state: { ...initial, inFlight: null },
      step: { outcome: "in_flight_superseded", ...base },
    };
  const pass = await passWithActiveCli(
    dependencies,
    await dependencies.listRepositories(),
    active,
    null,
  );
  let hostFailure: string | null = null;
  if (pass === null) {
    if (dependencies.signal?.aborted === true)
      return { state, step: { outcome: "interrupted", ...base } };
    const interruptions = inFlight.interruptions + 1;
    if (interruptions < FOLLOW_INTERRUPTION_LIMIT)
      return {
        state: { ...state, inFlight: { ...inFlight, interruptions } },
        step: {
          outcome: "interrupted",
          ...base,
          code: "host_follow_repository_upgrade_interrupted",
        },
      };
    hostFailure = "host_follow_repository_upgrade_interrupted";
  } else if (pass.outcome === "host_failure")
    hostFailure =
      pass.repositories.find((repository) => repository.outcome === "host_failure")?.code ??
      "host_follow_repository_upgrade_unreadable";
  if (hostFailure === null && pass !== null)
    return {
      state: { ...initial, inFlight: null, lastPass: pass },
      step: {
        outcome: "upgraded",
        ...base,
        pass,
        handover: await handoverDue(dependencies, active),
      },
    };
  const code = hostFailure as string;
  const failing = { ...inFlight, rollback: { code } };
  state = withFailedTag(
    { ...state, inFlight: failing },
    {
      tag: inFlight.tag,
      failedAt: dependencies.upgrade.now().toISOString(),
      code,
      activationId: inFlight.activationId,
    },
  );
  // The failed tag and the pending rollback are recorded first, so a crash never retries the tag.
  await writeFollowState(layout, state);
  return rollBack(dependencies, state, failing);
}
