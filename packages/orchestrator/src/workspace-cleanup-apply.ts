import {
  clearWorkspaceCleanupJournal,
  createWorkspaceCleanupJournal,
  listAssignments,
  readWorkspace,
  readWorkspaceCleanupJournal,
  recordWorkspaceCleanupRemoval,
  updateWorkspace,
  type AgentWorkspace,
  type WorkspaceCleanupJournal,
} from "@lervo/agent-workforce";
import { repositoryCoordinateDigest } from "@lervo/project-storage";
import {
  WorkspaceHostError,
  type WorkspaceCleanupHostAdapter,
  type WorkspaceCleanupHostInspection,
} from "@lervo/workspace-host";

import {
  isWorkspaceCleanupPlan,
  stableWorkspaceCleanupJson,
  workspaceCleanupDigest,
  type WorkspaceCleanupCoordinates,
  type WorkspaceCleanupPlan,
  type WorkspaceCleanupReceipt,
} from "./workspace-cleanup-contract.js";
import { pathPrivateWorkspaceCleanupEvidence } from "./workspace-cleanup-plan.js";

function journalFor(
  plan: WorkspaceCleanupPlan,
  coordinates: WorkspaceCleanupCoordinates,
): WorkspaceCleanupJournal {
  return {
    schemaVersion: 1,
    journalId: plan.journalId,
    planId: plan.planId,
    planContentHash: plan.contentHash,
    workspaceId: plan.workspaceId,
    generation: plan.workspaceGeneration,
    repositoryInstanceId: plan.repositoryInstanceId,
    repositoryRoot: coordinates.repositoryRoot,
    workspacePath: coordinates.workspacePath,
    baseCommit: plan.workspaceBaseCommit,
    integratedHeadCommit: plan.sealedHeadCommit,
    marker: plan.marker,
    idempotencyKey: plan.idempotencyKey,
    phase: "prepared",
    removalObservedAt: null,
    createdAt: plan.createdAt,
    updatedAt: plan.createdAt,
  };
}

function sameJournalBinding(
  journal: WorkspaceCleanupJournal,
  plan: WorkspaceCleanupPlan,
  coordinates: WorkspaceCleanupCoordinates,
): boolean {
  return (
    journal.journalId === plan.journalId &&
    journal.planId === plan.planId &&
    journal.planContentHash === plan.contentHash &&
    journal.workspaceId === plan.workspaceId &&
    journal.generation === plan.workspaceGeneration &&
    journal.repositoryInstanceId === plan.repositoryInstanceId &&
    journal.repositoryRoot === coordinates.repositoryRoot &&
    journal.workspacePath === coordinates.workspacePath &&
    journal.integratedHeadCommit === plan.sealedHeadCommit &&
    stableWorkspaceCleanupJson(journal.marker) === stableWorkspaceCleanupJson(plan.marker) &&
    journal.idempotencyKey === plan.idempotencyKey
  );
}

function receipt(plan: WorkspaceCleanupPlan, workspace: AgentWorkspace): WorkspaceCleanupReceipt {
  const content = {
    schemaVersion: 1 as const,
    status: "removed" as const,
    planId: plan.planId,
    workspaceId: workspace.workspaceId,
    generation: workspace.generation,
    integrationEvidenceId: plan.integrationEvidenceId,
    removedAt: workspace.updatedAt,
  };
  return { ...content, contentHash: workspaceCleanupDigest(content) };
}

function assertCoordinateBinding(
  plan: WorkspaceCleanupPlan,
  coordinates: WorkspaceCleanupCoordinates,
  host: WorkspaceCleanupHostAdapter,
): void {
  if (
    !isWorkspaceCleanupPlan(plan) ||
    plan.status !== "ready" ||
    plan.operation !== "remove_workspace_non_force" ||
    repositoryCoordinateDigest(coordinates.repositoryRoot) !== plan.repositoryRootDigest ||
    repositoryCoordinateDigest(coordinates.workspacePath) !== plan.workspacePathDigest ||
    repositoryCoordinateDigest(coordinates.integrationTargetRef) !== plan.integrationTargetDigest ||
    host.kind !== plan.hostKind ||
    host.version !== plan.hostVersion ||
    !host.capabilities.cleanupInspection ||
    !host.capabilities.nonForceRemoval
  )
    throw new WorkspaceHostError(
      "host_coordinate_invalid",
      "The cleanup plan or private coordinate binding is invalid.",
    );
}

async function exactInspection(input: {
  plan: WorkspaceCleanupPlan;
  coordinates: WorkspaceCleanupCoordinates;
  host: WorkspaceCleanupHostAdapter;
}): Promise<WorkspaceCleanupHostInspection> {
  const inspection = await input.host.inspectCleanup({
    repositoryRoot: input.coordinates.repositoryRoot,
    workspacePath: input.coordinates.workspacePath,
    baseCommit: input.plan.workspaceBaseCommit,
    marker: input.plan.marker,
    integrationTargetRef: input.coordinates.integrationTargetRef,
    integratedHeadCommit: input.plan.sealedHeadCommit,
  });
  if (
    inspection.status === "present" &&
    stableWorkspaceCleanupJson(pathPrivateWorkspaceCleanupEvidence(inspection)) !==
      stableWorkspaceCleanupJson(input.plan.hostEvidence)
  )
    throw new WorkspaceHostError(
      "host_effect_uncertain",
      "The cleanup host evidence changed before removal.",
    );
  return inspection;
}

async function ensureJournal(input: {
  plan: WorkspaceCleanupPlan;
  coordinates: WorkspaceCleanupCoordinates;
}): Promise<{ journal: WorkspaceCleanupJournal; contentHash: string }> {
  const current = await readWorkspaceCleanupJournal(
    input.coordinates.repositoryRoot,
    input.plan.journalId,
  );
  if (current !== null) {
    if (!sameJournalBinding(current.journal, input.plan, input.coordinates))
      throw new WorkspaceHostError(
        "host_effect_uncertain",
        "The cleanup journal is bound to different private coordinates.",
      );
    return current;
  }
  return createWorkspaceCleanupJournal({
    repositoryRoot: input.coordinates.repositoryRoot,
    journal: journalFor(input.plan, input.coordinates),
  });
}

async function completeRemovedWorkspace(input: {
  plan: WorkspaceCleanupPlan;
  coordinates: WorkspaceCleanupCoordinates;
  workspace: { workspace: AgentWorkspace; contentHash: string };
  journal: { journal: WorkspaceCleanupJournal; contentHash: string };
  occurredAt: string;
}): Promise<WorkspaceCleanupReceipt> {
  let journal = input.journal;
  if (journal.journal.phase === "prepared")
    journal = await recordWorkspaceCleanupRemoval({
      repositoryRoot: input.coordinates.repositoryRoot,
      journalId: journal.journal.journalId,
      expectedContentHash: journal.contentHash,
      observedAt: input.occurredAt,
    });
  const removed =
    input.workspace.workspace.state === "removed"
      ? input.workspace
      : await updateWorkspace({
          repositoryRoot: input.coordinates.repositoryRoot,
          workspaceId: input.plan.workspaceId,
          expectedContentHash: input.workspace.contentHash,
          eventId: input.plan.removedEventId,
          expectedRevision: input.workspace.workspace.revision,
          expectedGeneration: input.plan.workspaceGeneration,
          nextState: "removed",
          occurredAt: input.occurredAt,
          evidence: { hostAbsent: true, gitMetadataAbsent: true },
          reasonCode: "workspace_non_force_removed",
        });
  await clearWorkspaceCleanupJournal({
    repositoryRoot: input.coordinates.repositoryRoot,
    journalId: journal.journal.journalId,
    expectedContentHash: journal.contentHash,
  });
  return receipt(input.plan, removed.workspace);
}

export async function applyWorkspaceCleanup(input: {
  plan: WorkspaceCleanupPlan;
  coordinates: WorkspaceCleanupCoordinates;
  host: WorkspaceCleanupHostAdapter;
  now?: Date;
}): Promise<WorkspaceCleanupReceipt> {
  assertCoordinateBinding(input.plan, input.coordinates, input.host);
  let stored = await readWorkspace(input.coordinates.repositoryRoot, input.plan.workspaceId);
  if (stored === null || stored.workspace.generation !== input.plan.workspaceGeneration)
    throw new WorkspaceHostError("host_effect_uncertain", "The cleanup workspace is absent.");
  const existingJournal = await readWorkspaceCleanupJournal(
    input.coordinates.repositoryRoot,
    input.plan.journalId,
  );
  if (stored.workspace.state === "removed") {
    if (stored.workspace.cleanupPlanId !== input.plan.planId)
      throw new WorkspaceHostError(
        "host_effect_uncertain",
        "A different cleanup plan removed the workspace.",
      );
    if (existingJournal !== null) {
      if (!sameJournalBinding(existingJournal.journal, input.plan, input.coordinates))
        throw new WorkspaceHostError("host_effect_uncertain", "The cleanup journal changed.");
      await clearWorkspaceCleanupJournal({
        repositoryRoot: input.coordinates.repositoryRoot,
        journalId: existingJournal.journal.journalId,
        expectedContentHash: existingJournal.contentHash,
      });
    }
    return receipt(input.plan, stored.workspace);
  }
  if (
    stored.workspace.state === "integrated" &&
    (stored.workspace.revision !== input.plan.workspaceRevision ||
      stored.contentHash !== input.plan.workspaceContentHash)
  )
    throw new WorkspaceHostError("host_effect_uncertain", "The cleanup workspace changed.");
  if (
    !["integrated", "cleanup_eligible", "removing"].includes(stored.workspace.state) ||
    (stored.workspace.state === "removing" && stored.workspace.cleanupPlanId !== input.plan.planId)
  )
    throw new WorkspaceHostError(
      "host_effect_uncertain",
      "The workspace is not in this cleanup transaction.",
    );
  const assignment = (await listAssignments(input.coordinates.repositoryRoot)).find(
    (item) => item.assignmentId === input.plan.assignmentId,
  );
  if (
    assignment === undefined ||
    assignment.revision !== input.plan.assignmentRevision ||
    assignment.lease !== null
  )
    throw new WorkspaceHostError("host_effect_uncertain", "The cleanup assignment changed.");
  const before = await exactInspection(input);
  const journal = await ensureJournal(input);
  const occurredAt = (input.now ?? new Date()).toISOString();
  if (before.status === "absent")
    return completeRemovedWorkspace({
      ...input,
      workspace: stored,
      journal,
      occurredAt,
    });
  if (stored.workspace.state === "integrated") {
    stored = await updateWorkspace({
      repositoryRoot: input.coordinates.repositoryRoot,
      workspaceId: input.plan.workspaceId,
      expectedContentHash: stored.contentHash,
      eventId: input.plan.eligibleEventId,
      expectedRevision: stored.workspace.revision,
      expectedGeneration: input.plan.workspaceGeneration,
      nextState: "cleanup_eligible",
      occurredAt,
      evidence: { cleanupEligible: true },
      cleanupPlanId: input.plan.planId,
      reasonCode: "cleanup_evidence_current",
    });
  }
  if (stored.workspace.state === "cleanup_eligible")
    stored = await updateWorkspace({
      repositoryRoot: input.coordinates.repositoryRoot,
      workspaceId: input.plan.workspaceId,
      expectedContentHash: stored.contentHash,
      eventId: input.plan.removingEventId,
      expectedRevision: stored.workspace.revision,
      expectedGeneration: input.plan.workspaceGeneration,
      nextState: "removing",
      occurredAt,
      evidence: { cleanupPlanBound: true },
      cleanupPlanId: input.plan.planId,
      reasonCode: "cleanup_non_force_started",
    });
  let after;
  try {
    after = await input.host.remove({
      repositoryRoot: input.coordinates.repositoryRoot,
      workspacePath: input.coordinates.workspacePath,
      baseCommit: input.plan.workspaceBaseCommit,
      marker: input.plan.marker,
      idempotencyKey: input.plan.idempotencyKey,
    });
  } catch (error) {
    const recovered = await input.host.inspectCleanup({
      repositoryRoot: input.coordinates.repositoryRoot,
      workspacePath: input.coordinates.workspacePath,
      baseCommit: input.plan.workspaceBaseCommit,
      marker: input.plan.marker,
      integrationTargetRef: input.coordinates.integrationTargetRef,
      integratedHeadCommit: input.plan.sealedHeadCommit,
    });
    if (recovered.status !== "absent") throw error;
    after = recovered;
  }
  if (after.status !== "absent")
    throw new WorkspaceHostError(
      "host_effect_uncertain",
      "The cleanup host did not prove complete non-force removal.",
    );
  return completeRemovedWorkspace({
    ...input,
    workspace: stored,
    journal,
    occurredAt,
  });
}
