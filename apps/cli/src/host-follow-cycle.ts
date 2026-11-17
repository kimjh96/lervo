import { errorCode } from "./command-error-output.js";
import { readActivationJournal } from "./host-cli-activation.js";
import type {
  HostFollowCycleDependencies,
  HostFollowCycleResult,
  HostFollowStep,
  HostFollowStepResult,
} from "./host-follow-cycle-contract.js";
import {
  chooseFollowTarget,
  classifyInstallFailure,
  FOLLOW_INSTALL_FAILURE_LIMIT,
  publishedReleases,
  repositoryPassDue,
} from "./host-follow-policy.js";
import { readActiveCli, type ActiveCli } from "./host-follow-runtime.js";
import {
  activationOfIntent,
  dueRepositories,
  handoverDue,
  retryRepositories,
  settleInFlight,
  upgradeRepositories,
} from "./host-follow-settlement.js";
import {
  readFollowControl,
  readFollowState,
  withFailedTag,
  writeFollowState,
  type HostFollowState,
} from "./host-follow-state.js";
import { applyReleaseUpgrade } from "./host-upgrade.js";

export type {
  HostFollowCycleDependencies,
  HostFollowCycleOutcome,
  HostFollowCycleResult,
} from "./host-follow-cycle-contract.js";

/**
 * What a failed install means for the follower. A transient installer failure counts against the
 * tag and backs off; after FOLLOW_INSTALL_FAILURE_LIMIT in a row, the tag fails like a
 * deterministic one. A failed health gate or link switch names the activation it restored.
 */
async function installFailed(
  dependencies: HostFollowCycleDependencies,
  state: HostFollowState,
  tag: string,
  code: string,
  intendedActivationId: string,
): Promise<HostFollowStepResult> {
  const now = dependencies.upgrade.now().toISOString();
  const kind = classifyInstallFailure(code);
  if (kind === "transient") {
    if (code === "host_upgrade_in_progress") return { state, step: { outcome: "busy", tag, code } };
    if (code === "host_release_unavailable")
      return {
        state: { ...state, consecutiveSourceFailures: state.consecutiveSourceFailures + 1 },
        step: { outcome: "install_retry", tag, code },
      };
    const count = state.installFailures?.tag === tag ? state.installFailures.count + 1 : 1;
    if (count < FOLLOW_INSTALL_FAILURE_LIMIT)
      return {
        state: { ...state, installFailures: { tag, count, code } },
        step: { outcome: "install_retry", tag, code },
      };
  }
  if (kind === "waiting") return { state, step: { outcome: "waiting", tag, code } };
  if (kind === "host_blocked") return { state, step: { outcome: "host_blocked", tag, code } };
  // A failed health gate or link switch restored the links under the follower's own record.
  const restored = (await readActivationJournal(dependencies.upgrade.layout).catch(() => [])).some(
    (record) => record.activationId === intendedActivationId && record.outcome === "restored",
  );
  const activationId = restored ? intendedActivationId : null;
  return {
    state: withFailedTag(
      { ...state, installFailures: null },
      { tag, failedAt: now, code, activationId },
    ),
    step: { outcome: "release_failed", tag, code, activationId },
  };
}

/**
 * Installs one release under a recorded intent, then settles it. The intent and its activation id
 * are written before the install, which records exactly that id, so a throw or crash after the
 * links switched still leaves the activation owned, and an activation the owner made by hand
 * never is.
 */
async function install(
  dependencies: HostFollowCycleDependencies,
  initial: HostFollowState,
  tag: string,
): Promise<HostFollowStepResult> {
  const { layout } = dependencies.upgrade;
  const activationId = dependencies.upgrade.newActivationId();
  const intent = {
    tag,
    activationId,
    startedAt: dependencies.upgrade.now().toISOString(),
    rollback: null,
    interruptions: 0,
  };
  let state: HostFollowState = { ...initial, inFlight: intent };
  await writeFollowState(layout, state);
  let installed;
  try {
    installed = await applyReleaseUpgrade(dependencies.source, tag, {
      ...dependencies.upgrade,
      newActivationId: () => activationId,
    });
  } catch (error) {
    const owned = activationOfIntent(await readActivationJournal(layout).catch(() => []), intent);
    if (owned === undefined || (owned.outcome !== "active" && owned.outcome !== "pending"))
      return installFailed(
        dependencies,
        { ...state, inFlight: null },
        tag,
        errorCode(error),
        activationId,
      );
    state = { ...state, installFailures: null };
    return settleInFlight(dependencies, state, await readActiveCli(layout));
  }
  state = { ...state, installFailures: null };
  if (installed.status === "current")
    return { state: { ...state, inFlight: null }, step: { outcome: "current", tag } };
  return settleInFlight(dependencies, state, await readActiveCli(layout));
}

/**
 * ADR-0575, one follow cycle: settle the follower's own unsettled release first, hand over to the
 * active CLI, honour a pause, upgrade repositories for a CLI the last pass did not run, otherwise
 * poll the newest published release and install it, or retry repositories whose retry is due.
 */
export async function runFollowCycle(
  dependencies: HostFollowCycleDependencies,
): Promise<HostFollowCycleResult> {
  const { layout } = dependencies.upgrade;
  const now = () => dependencies.upgrade.now();
  let state = await readFollowState(layout);
  const control = await readFollowControl(layout);
  const finish = async (next: HostFollowStepResult): Promise<HostFollowCycleResult> => {
    state = next.state;
    const { step } = next;
    const result: HostFollowCycleResult = {
      tag: null,
      code: null,
      activationId: null,
      pass: null,
      handover: step.outcome === "handover",
      ...step,
      consecutiveSourceFailures: state.consecutiveSourceFailures,
      backoff: Math.max(state.consecutiveSourceFailures, state.installFailures?.count ?? 0),
    };
    state = {
      ...state,
      lastOutcome: {
        at: now().toISOString(),
        outcome: result.outcome,
        tag: result.tag,
        code: result.code,
      },
    };
    await writeFollowState(layout, state);
    return result;
  };
  const stop = (step: HostFollowStep) => finish({ state, step });

  let active: ActiveCli;
  try {
    active = await readActiveCli(layout);
  } catch (error) {
    return stop({ outcome: "host_blocked", code: errorCode(error) });
  }
  if (dependencies.signal?.aborted === true) return stop({ outcome: "interrupted" });
  // An unsettled release is settled before any handover: until its pass proves it, the runtime
  // link must not move to it, whichever process runs.
  if (state.inFlight !== null) return finish(await settleInFlight(dependencies, state, active));
  if (await handoverDue(dependencies, active)) return stop({ outcome: "handover" });
  if (control.paused) return stop({ outcome: "paused" });
  if (repositoryPassDue(state, active))
    return finish(await upgradeRepositories(dependencies, state, active));

  let releases;
  try {
    releases = await dependencies.source.listReleases();
  } catch (error) {
    state = { ...state, consecutiveSourceFailures: state.consecutiveSourceFailures + 1 };
    return stop({ outcome: "source_unavailable", code: errorCode(error) });
  }
  state = {
    ...state,
    repository: dependencies.source.repository,
    lastCheckAt: now().toISOString(),
    lastSeenTag: publishedReleases(releases)[0]?.tag ?? null,
    consecutiveSourceFailures: 0,
  };
  const target = chooseFollowTarget({
    releases,
    activeVersion: active.version,
    failedTags: state.failedTags.map((entry) => entry.tag),
    pinnedTag: control.pinnedTag,
  });
  if (target.kind === "install") return finish(await install(dependencies, state, target.tag));
  const due = dueRepositories(state, active, now());
  if (due.length > 0) return finish(await retryRepositories(dependencies, state, active, due));
  return stop({ outcome: target.reason, tag: target.tag });
}
