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
 * The record of a preparation that stopped before its host effect: it exists only as created, as
 * the provision's own uncertain recovery, or as this plan's withdrawal of it, and no ready event,
 * checkout path, or Git registration exists. Any other record may hold host work and is not this.
 */
export async function observeUnhostedWorkspace(input: {
  repositoryRoot: string;
  plan: OperatingActionPlanV1;
  provision: WorkspaceProvisionPlan;
}): Promise<StoredWorkspace | null> {
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
    ) ||
    !(await pathAbsent(provision.workspacePath))
  )
    return null;
  const observed = await new GitWorkspaceHostAdapter().inspect({
    repositoryRoot: input.repositoryRoot,
    workspacePath: provision.workspacePath,
    baseCommit: provision.baseCommit,
    marker: provision.marker,
  });
  return observed.status === "absent" ? stored : null;
}

/**
 * Removes a never-hosted record so its workspace identity holds no execution authority. A created
 * record first takes the provision's own recovery transition; a rerun resumes where it stopped.
 */
export async function withdrawUnhostedWorkspace(input: {
  repositoryRoot: string;
  plan: OperatingActionPlanV1;
  provision: WorkspaceProvisionPlan;
  now(): string;
}): Promise<void> {
  let stored = await observeUnhostedWorkspace(input);
  if (stored === null) throw new Error("The workspace record is not a never-hosted preparation.");
  const workspaceId = input.provision.workspace.workspaceId;
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
    stored = await observeUnhostedWorkspace(input);
    if (stored === null) throw new Error("The workspace record changed during withdrawal.");
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
