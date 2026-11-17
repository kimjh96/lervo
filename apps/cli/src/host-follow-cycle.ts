import { errorCode } from "./command-error-output.js";
import { readActivationJournal } from "./host-cli-activation.js";
import {
  chooseFollowTarget,
  classifyInstallFailure,
  publishedReleases,
  repositoryPassDue,
} from "./host-follow-policy.js";
import { pointFollowRuntime, readActiveCli, type ActiveCli } from "./host-follow-runtime.js";
import {
  readFollowControl,
  readFollowState,
  withFailedTag,
  writeFollowState,
  type HostFollowPass,
  type HostFollowState,
} from "./host-follow-state.js";
import type { HostReleaseSource } from "./host-release-source.js";
import { runRepositoryPass } from "./host-repository-pass.js";
import type { RepositoryUpgradeRunner } from "./host-repository-upgrade-runner.js";
import { applyReleaseUpgrade, type HostUpgradeDependencies } from "./host-upgrade.js";
import { rollbackActivation } from "./host-upgrade-rollback.js";

export interface HostFollowCycleDependencies {
  /** The ADR-0571 host upgrade ports; the follower installs and rolls back through them. */
  upgrade: HostUpgradeDependencies;
  source: HostReleaseSource;
  /** Roots of every repository registered on this host. */
  listRepositories: () => Promise<string[]>;
  runRepositoryUpgrade: RepositoryUpgradeRunner;
  /** The physical package root this process runs, or null outside an installed CLI. */
  runningInstallRoot: () => Promise<string | null>;
}

export type HostFollowCycleOutcome =
  | "paused"
  | "handover"
  | "current"
  | "no_published_release"
  | "release_failed_on_host"
  | "pinned_release_unavailable"
  | "pinned_release_reached"
  | "source_unavailable"
  | "waiting"
  | "busy"
  | "install_retry"
  | "host_blocked"
  | "release_failed"
  | "rolled_back"
  | "rollback_failed"
  | "upgraded"
  | "repositories_upgraded";

export interface HostFollowCycleResult {
  outcome: HostFollowCycleOutcome;
  tag: string | null;
  code: string | null;
  activationId: string | null;
  pass: HostFollowPass | null;
  /** The process must exit so the service manager restarts it on the CLI the link runs now. */
  handover: boolean;
  consecutiveSourceFailures: number;
}

/**
 * True when this process runs another package than the `lervo` link: the follower then points its
 * runtime link at the active package and must exit, because Node never reloads a running program.
 */
async function handoverDue(
  dependencies: HostFollowCycleDependencies,
  active: ActiveCli,
): Promise<boolean> {
  if (active.packageRoot === null) return false;
  await pointFollowRuntime(dependencies.upgrade.layout, active.packageRoot);
  const running = await dependencies.runningInstallRoot();
  return running !== null && running !== active.packageRoot;
}

/**
 * ADR-0575, one follow cycle: hand over to the active CLI, honour a pause, finish a repository
 * pass that is due, otherwise poll the newest published release, install it through ADR-0571,
 * and run the repository pass with it. A host failure in that pass rolls the activation back by
 * id and marks the tag failed; the follower then never installs that tag by itself again.
 */
export async function runFollowCycle(
  dependencies: HostFollowCycleDependencies,
): Promise<HostFollowCycleResult> {
  const { layout } = dependencies.upgrade;
  const now = () => dependencies.upgrade.now().toISOString();
  let state = await readFollowState(layout);
  const control = await readFollowControl(layout);
  const finish = async (
    outcome: HostFollowCycleOutcome,
    details: Partial<Omit<HostFollowCycleResult, "outcome" | "consecutiveSourceFailures">> = {},
  ): Promise<HostFollowCycleResult> => {
    const result: HostFollowCycleResult = {
      outcome,
      tag: null,
      code: null,
      activationId: null,
      pass: null,
      handover: outcome === "handover",
      ...details,
      consecutiveSourceFailures: state.consecutiveSourceFailures,
    };
    state = {
      ...state,
      lastOutcome: { at: now(), outcome, tag: result.tag, code: result.code },
    };
    await writeFollowState(layout, state);
    return result;
  };

  let active: ActiveCli;
  try {
    active = await readActiveCli(layout);
  } catch (error) {
    return finish("host_blocked", { code: errorCode(error) });
  }
  if (await handoverDue(dependencies, active)) return finish("handover");
  if (control.paused) return finish("paused");
  if (repositoryPassDue(state, active)) {
    const settled = await settleRepositoryPass(dependencies, state, active);
    state = settled.state;
    return finish(settled.result.outcome, settled.result);
  }

  let releases;
  try {
    releases = await dependencies.source.listReleases();
  } catch (error) {
    state = { ...state, consecutiveSourceFailures: state.consecutiveSourceFailures + 1 };
    return finish("source_unavailable", { code: errorCode(error) });
  }
  state = {
    ...state,
    repository: dependencies.source.repository,
    lastCheckAt: now(),
    lastSeenTag: publishedReleases(releases)[0]?.tag ?? null,
    consecutiveSourceFailures: 0,
  };
  const target = chooseFollowTarget({
    releases,
    activeVersion: active.version,
    failedTags: state.failedTags.map((entry) => entry.tag),
    pinnedTag: control.pinnedTag,
  });
  if (target.kind === "idle") return finish(target.reason, { tag: target.tag });

  let installed;
  try {
    installed = await applyReleaseUpgrade(dependencies.source, target.tag, dependencies.upgrade);
  } catch (error) {
    const code = errorCode(error);
    const kind = classifyInstallFailure(code);
    if (kind === "transient") {
      if (code === "host_release_unavailable")
        state = { ...state, consecutiveSourceFailures: state.consecutiveSourceFailures + 1 };
      return finish(code === "host_upgrade_in_progress" ? "busy" : "install_retry", {
        tag: target.tag,
        code,
      });
    }
    if (kind === "waiting") return finish("waiting", { tag: target.tag, code });
    if (kind === "host_blocked") return finish("host_blocked", { tag: target.tag, code });
    // A failed health gate or link switch already restored the links under the activation it
    // recorded last; every other failure happened before any activation.
    const restored = ["host_upgrade_health_failed", "host_upgrade_switch_failed"].includes(code)
      ? (await readActivationJournal(layout).catch(() => []))
          .filter((record) => record.release?.tag === target.tag && record.outcome === "restored")
          .at(-1)
      : undefined;
    const activationId = restored?.activationId ?? null;
    state = withFailedTag(state, { tag: target.tag, failedAt: now(), code, activationId });
    return finish("release_failed", { tag: target.tag, code, activationId });
  }
  if (installed.status === "current" && !repositoryPassDue(state, active))
    return finish("current", { tag: target.tag });
  if (installed.status === "activated") {
    state = {
      ...state,
      inFlight: {
        tag: target.tag,
        activationId: installed.activation.activationId,
        startedAt: now(),
      },
    };
    // Persisted before the pass, so a follower restarted mid-pass still owns this activation.
    await writeFollowState(layout, state);
  }
  const settled = await settleRepositoryPass(dependencies, state, await readActiveCli(layout));
  state = settled.state;
  return finish(settled.result.outcome, settled.result);
}

type SettledPass = {
  state: HostFollowState;
  result: Omit<HostFollowCycleResult, "consecutiveSourceFailures">;
};

async function passOn(
  dependencies: HostFollowCycleDependencies,
  roots: readonly string[],
  active: ActiveCli,
  finishedAt: string,
): Promise<HostFollowPass> {
  const pass = await runRepositoryPass(roots, dependencies.runRepositoryUpgrade);
  return {
    cliTarget: active.target ?? "",
    version: active.version,
    finishedAt,
    outcome: pass.outcome,
    repositories: pass.repositories,
  };
}

/**
 * Runs `lervo upgrade` on every registered repository with the active CLI. When the pass belongs
 * to the follower's own activation and fails on the host, the activation is rolled back by id,
 * the tag is marked failed, and a second pass converges the repositories on the restored CLI.
 */
async function settleRepositoryPass(
  dependencies: HostFollowCycleDependencies,
  initial: HostFollowState,
  active: ActiveCli,
): Promise<SettledPass> {
  const { layout } = dependencies.upgrade;
  const now = () => dependencies.upgrade.now().toISOString();
  const roots = await dependencies.listRepositories();
  const inFlight = initial.inFlight;
  const pass = await passOn(dependencies, roots, active, now());
  const base = { tag: inFlight?.tag ?? null, activationId: inFlight?.activationId ?? null };
  if (pass.outcome !== "host_failure" || inFlight === null) {
    const handover = await handoverDue(dependencies, active);
    return {
      state: { ...initial, inFlight: null, lastPass: pass },
      result: {
        outcome: inFlight === null ? "repositories_upgraded" : "upgraded",
        ...base,
        code: null,
        pass,
        handover,
      },
    };
  }
  const code =
    pass.repositories.find((repository) => repository.outcome === "host_failure")?.code ??
    "host_follow_repository_upgrade_unreadable";
  let state = withFailedTag(
    { ...initial, inFlight: null, lastPass: pass },
    { tag: inFlight.tag, failedAt: now(), code, activationId: inFlight.activationId },
  );
  // The failed tag is recorded before the rollback, so a crash here never retries it.
  await writeFollowState(layout, state);
  try {
    await rollbackActivation(inFlight.activationId, true, dependencies.upgrade);
  } catch (error) {
    return {
      state,
      result: {
        outcome: "rollback_failed",
        ...base,
        code: errorCode(error),
        pass,
        handover: false,
      },
    };
  }
  const restored = await readActiveCli(layout);
  const converged = await passOn(dependencies, roots, restored, now());
  state = { ...state, lastPass: converged };
  return {
    state,
    result: {
      outcome: "rolled_back",
      ...base,
      code,
      pass: converged,
      handover: await handoverDue(dependencies, restored),
    },
  };
}
