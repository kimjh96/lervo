import {
  isWorkspaceIntegrationQueueEntry,
  readWorkspace,
  updateWorkspace,
  type AgentWorkspace,
  type WorkspaceIntegrationQueueEntry,
} from "@lervo/agent-workforce";
import { RepositoryCoordinationRecords } from "@lervo/project-storage";
import { WorkspaceHostError } from "@lervo/workspace-host";

import {
  stableWorkspaceIntegrationJson,
  type WorkspaceIntegrationPlan,
  type WorkspaceIntegrationPlanSource,
} from "./workspace-integration-contract.js";

interface WorkspaceStateEvent {
  eventId: string;
  workspaceId: string;
  generation: number;
  state: string;
  revision: number;
}

async function exactEvent(input: {
  repositoryRoot: string;
  eventId: string;
  workspaceId: string;
  generation: number;
  state: "integrating" | "integration_conflict";
  revision: number;
}): Promise<boolean> {
  const records = await RepositoryCoordinationRecords.open(input.repositoryRoot);
  const event = await records.read<WorkspaceStateEvent>("events", input.eventId);
  return (
    event !== null &&
    event.value.eventId === input.eventId &&
    event.value.workspaceId === input.workspaceId &&
    event.value.generation === input.generation &&
    event.value.state === input.state &&
    event.value.revision === input.revision
  );
}

async function assertQueueBinding(
  plan: WorkspaceIntegrationPlan,
  source: WorkspaceIntegrationPlanSource,
): Promise<void> {
  const records = await RepositoryCoordinationRecords.open(plan.repositoryRoot);
  const stored = await records.read<WorkspaceIntegrationQueueEntry>(
    "integrations",
    source.queueEntryId,
  );
  if (
    stored === null ||
    !isWorkspaceIntegrationQueueEntry(stored.value) ||
    stored.value.workspaceId !== source.workspaceId ||
    stored.value.generation !== source.generation ||
    stored.value.assignmentId !== source.assignmentId ||
    stored.value.headCommit !== source.headCommit ||
    stored.value.treeHash !== source.treeHash ||
    stored.value.changedPathSetDigest !== source.changedPathSetDigest
  )
    throw new WorkspaceHostError(
      "host_effect_uncertain",
      "An integration queue binding changed before apply.",
    );
}

function exactPendingSource(
  stored: { workspace: AgentWorkspace; contentHash: string },
  source: WorkspaceIntegrationPlanSource,
): boolean {
  return (
    stored.workspace.state === "integration_pending" &&
    stored.workspace.generation === source.generation &&
    stored.workspace.revision === source.workspaceRevision &&
    stored.contentHash === source.workspaceContentHash &&
    stored.workspace.integrationQueueEntryId === source.queueEntryId &&
    stored.workspace.sealedResult?.headCommit === source.headCommit &&
    stored.workspace.sealedResult.treeHash === source.treeHash &&
    stableWorkspaceIntegrationJson(stored.workspace.sealedResult.commitIds) ===
      stableWorkspaceIntegrationJson(source.commitIds)
  );
}

async function exactIntegratingSource(
  plan: WorkspaceIntegrationPlan,
  stored: { workspace: AgentWorkspace; contentHash: string },
  source: WorkspaceIntegrationPlanSource,
): Promise<boolean> {
  return (
    stored.workspace.state === "integrating" &&
    stored.workspace.generation === source.generation &&
    stored.workspace.revision === source.workspaceRevision + 1 &&
    stored.workspace.integrationQueueEntryId === source.queueEntryId &&
    stored.workspace.sealedResult?.headCommit === source.headCommit &&
    (await exactEvent({
      repositoryRoot: plan.repositoryRoot,
      eventId: source.integratingEventId,
      workspaceId: source.workspaceId,
      generation: source.generation,
      state: "integrating",
      revision: source.workspaceRevision + 1,
    }))
  );
}

export async function assertIntegrationSourceBindings(
  plan: WorkspaceIntegrationPlan,
): Promise<void> {
  await Promise.all(plan.sources.map((source) => assertQueueBinding(plan, source)));
}

async function recoverStartedSources(
  plan: WorkspaceIntegrationPlan,
  sources: WorkspaceIntegrationPlanSource[],
  occurredAt: string,
): Promise<void> {
  await Promise.all(
    sources.map(async (source) => {
      const stored = await readWorkspace(plan.repositoryRoot, source.workspaceId);
      if (stored?.workspace.state !== "integrating") return;
      await updateWorkspace({
        repositoryRoot: plan.repositoryRoot,
        workspaceId: source.workspaceId,
        expectedContentHash: stored.contentHash,
        eventId: source.recoveryEventId,
        expectedRevision: stored.workspace.revision,
        expectedGeneration: source.generation,
        nextState: "recovery_required",
        occurredAt,
        recoveryReason: "integration_transition_incomplete",
        reasonCode: "integration_transition_incomplete",
      });
    }),
  );
}

export async function startIntegrationSources(
  plan: WorkspaceIntegrationPlan,
  occurredAt: string,
): Promise<void> {
  const started: WorkspaceIntegrationPlanSource[] = [];
  try {
    for (const source of plan.sources) {
      const stored = await readWorkspace(plan.repositoryRoot, source.workspaceId);
      if (stored === null)
        throw new WorkspaceHostError("host_effect_uncertain", "An integration source is absent.");
      if (await exactIntegratingSource(plan, stored, source)) continue;
      if (!exactPendingSource(stored, source))
        throw new WorkspaceHostError(
          "host_effect_uncertain",
          "An integration source changed before its attempt started.",
        );
      await updateWorkspace({
        repositoryRoot: plan.repositoryRoot,
        workspaceId: source.workspaceId,
        expectedContentHash: stored.contentHash,
        eventId: source.integratingEventId,
        expectedRevision: source.workspaceRevision,
        expectedGeneration: source.generation,
        nextState: "integrating",
        occurredAt,
        evidence: { integrationLeaseHeld: true },
        reasonCode: "integration_candidate_started",
      });
      started.push(source);
    }
  } catch (error) {
    await recoverStartedSources(plan, started, occurredAt);
    throw error;
  }
}

export async function finalizeIntegrationConflictSources(
  plan: WorkspaceIntegrationPlan,
  occurredAt: string,
): Promise<void> {
  for (const source of plan.sources) {
    const stored = await readWorkspace(plan.repositoryRoot, source.workspaceId);
    if (stored === null)
      throw new WorkspaceHostError("host_effect_uncertain", "An integration source is absent.");
    if (
      stored.workspace.state === "integration_conflict" &&
      stored.workspace.revision === source.workspaceRevision + 2 &&
      (await exactEvent({
        repositoryRoot: plan.repositoryRoot,
        eventId: source.conflictEventId,
        workspaceId: source.workspaceId,
        generation: source.generation,
        state: "integration_conflict",
        revision: source.workspaceRevision + 2,
      }))
    )
      continue;
    if (!(await exactIntegratingSource(plan, stored, source)))
      throw new WorkspaceHostError(
        "host_effect_uncertain",
        "A conflicting integration source is not bound to this attempt.",
      );
    await updateWorkspace({
      repositoryRoot: plan.repositoryRoot,
      workspaceId: source.workspaceId,
      expectedContentHash: stored.contentHash,
      eventId: source.conflictEventId,
      expectedRevision: stored.workspace.revision,
      expectedGeneration: source.generation,
      nextState: "integration_conflict",
      occurredAt,
      evidence: { conflictAborted: true },
      reasonCode: "git_conflict_aborted",
    });
  }
}
