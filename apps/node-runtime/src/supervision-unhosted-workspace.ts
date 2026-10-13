import { lstat } from "node:fs/promises";
import {
  listWorkspaceCoordinationEvents,
  readWorkspace,
  updateWorkspace,
} from "@lervo/agent-workforce";
import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import type { WorkspaceProvisionPlan } from "@lervo/orchestrator";
import { operatingContractHash } from "@lervo/work-controller";
import { GitWorkspaceHostAdapter } from "@lervo/workspace-host-git";

const UNHOSTED = "host_effect_uncertain";
const WITHDRAWAL = "unhosted_preparation_withdrawn";

type StoredWorkspace = NonNullable<Awaited<ReturnType<typeof readWorkspace>>>;

/** The deterministic coordination event that withdraws one plan's never-hosted workspace record. */
export function unhostedWorkspaceWithdrawalEventId(plan: OperatingActionPlanV1): string {
  return `evt_${operatingContractHash({ planHash: operatingContractHash(plan), type: WITHDRAWAL }).slice(7, 39)}`;
}

async function pathAbsent(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}

/**
 * The record of a preparation that never reached ready: it exists only as created, as the
 * provision's own uncertain recovery, or as this plan's withdrawal of it, with no ready event and
 * no writer. Either Git holds no checkout for it, or, after the provision ended, Git holds an
 * untouched one: its marker matches, it is clean at the base commit, and no Git operation runs.
 * Any other record may hold work and is not this.
 */
export async function observeUnhostedWorkspace(input: {
  repositoryRoot: string;
  plan: OperatingActionPlanV1;
  provision: WorkspaceProvisionPlan;
}): Promise<{ stored: StoredWorkspace; checkoutPresent: boolean } | null> {
  const { provision } = input;
  const workspaceId = provision.workspace.workspaceId;
  const stored = await readWorkspace(input.repositoryRoot, workspaceId);
  if (stored === null) return null;
  const allowed = [
    provision.provisionEventId,
    provision.recoveryEventId,
    unhostedWorkspaceWithdrawalEventId(input.plan),
  ];
  const events = (await listWorkspaceCoordinationEvents(input.repositoryRoot)).filter(
    (event) => event.workspaceId === workspaceId,
  );
  const { workspace } = stored;
  if (
    events.some((event) => !allowed.includes(event.eventId)) ||
    !events.some((event) => event.eventId === provision.provisionEventId) ||
    workspace.writerSession !== null ||
    workspace.host.nativeInstanceDigest !== null ||
    !(
      (workspace.state === "provisioning" && workspace.revision === 1) ||
      (workspace.state === "recovery_required" &&
        workspace.revision === 2 &&
        workspace.recoveryReason === UNHOSTED) ||
      (workspace.state === "removed" && workspace.revision === 3)
    )
  )
    return null;
  const pathPresent = !(await pathAbsent(provision.workspacePath));
  const observed = await new GitWorkspaceHostAdapter().inspect({
    repositoryRoot: input.repositoryRoot,
    workspacePath: provision.workspacePath,
    baseCommit: provision.baseCommit,
    marker: provision.marker,
  });
  if (!pathPresent && observed.status === "absent") return { stored, checkoutPresent: false };
  return pathPresent &&
    workspace.state === "recovery_required" &&
    observed.status === "present" &&
    observed.markerMatched &&
    observed.headCommit === provision.baseCommit &&
    observed.clean === true &&
    observed.gitOperationInProgress === false
    ? { stored, checkoutPresent: true }
    : null;
}

/**
 * Removes a never-ready preparation so its workspace identity holds no execution authority: an
 * untouched checkout is first removed without force, and a created record first takes the
 * provision's own recovery transition. A rerun resumes where it stopped.
 */
export async function withdrawUnhostedWorkspace(input: {
  repositoryRoot: string;
  plan: OperatingActionPlanV1;
  provision: WorkspaceProvisionPlan;
  now(): string;
}): Promise<void> {
  let observed = await observeUnhostedWorkspace(input);
  if (observed === null) throw new Error("The workspace record is not a never-ready preparation.");
  const { provision } = input;
  if (observed.checkoutPresent) {
    // Git refuses a dirty or changed checkout; a forced removal is never used.
    const removed = await new GitWorkspaceHostAdapter().remove({
      repositoryRoot: input.repositoryRoot,
      workspacePath: provision.workspacePath,
      baseCommit: provision.baseCommit,
      marker: provision.marker,
      idempotencyKey: `idk_${unhostedWorkspaceWithdrawalEventId(input.plan).slice(4)}`,
    });
    if (removed.status !== "absent") throw new Error("Git did not prove the checkout was removed.");
    observed = await observeUnhostedWorkspace(input);
    if (observed === null || observed.checkoutPresent)
      throw new Error("The workspace changed during checkout removal.");
  }
  let stored = observed.stored;
  const workspaceId = provision.workspace.workspaceId;
  if (stored.workspace.state === "provisioning") {
    await updateWorkspace({
      repositoryRoot: input.repositoryRoot,
      workspaceId,
      expectedContentHash: stored.contentHash,
      expectedRevision: stored.workspace.revision,
      expectedGeneration: stored.workspace.generation,
      nextState: "recovery_required",
      occurredAt: input.now(),
      recoveryReason: UNHOSTED,
      reasonCode: UNHOSTED,
      eventId: input.provision.recoveryEventId,
    });
    const next = await observeUnhostedWorkspace(input);
    if (next === null || next.checkoutPresent)
      throw new Error("The workspace record changed during withdrawal.");
    stored = next.stored;
  }
  if (stored.workspace.state === "removed") return;
  await updateWorkspace({
    repositoryRoot: input.repositoryRoot,
    workspaceId,
    expectedContentHash: stored.contentHash,
    expectedRevision: stored.workspace.revision,
    expectedGeneration: stored.workspace.generation,
    nextState: "removed",
    occurredAt: input.now(),
    evidence: { hostAbsent: true, gitMetadataAbsent: true },
    reasonCode: WITHDRAWAL,
    eventId: unhostedWorkspaceWithdrawalEventId(input.plan),
  });
}
