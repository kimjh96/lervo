import { createHash } from "node:crypto";

import {
  clearWorkspaceCleanupJournal,
  readWorkspace,
  readWorkspaceCleanupJournal,
  recordWorkspaceCleanupRemoval,
  updateWorkspace,
  type AgentWorkspace,
} from "@lervo/agent-workforce";
import { WorkspaceHostError, type WorkspaceCleanupHostAdapter } from "@lervo/workspace-host";

import type { WorkspaceCleanupCoordinates } from "./workspace-cleanup-contract.js";

function derivedEventId(journalId: string, purpose: "removed" | "restored"): string {
  return `evt_${createHash("sha256").update(`${journalId}:${purpose}`).digest("hex").slice(0, 24)}`;
}

export async function recoverWorkspaceCleanup(input: {
  coordinates: WorkspaceCleanupCoordinates;
  journalId: string;
  host: WorkspaceCleanupHostAdapter;
  now?: Date;
}): Promise<{ status: "removed" | "eligible" | "recovery_required"; workspace: AgentWorkspace }> {
  const journal = await readWorkspaceCleanupJournal(
    input.coordinates.repositoryRoot,
    input.journalId,
  );
  if (journal === null)
    throw new WorkspaceHostError("host_coordinate_invalid", "The cleanup journal is absent.");
  if (
    journal.journal.repositoryRoot !== input.coordinates.repositoryRoot ||
    journal.journal.workspacePath !== input.coordinates.workspacePath ||
    input.host.kind !== journal.journal.marker.adapterKind ||
    input.host.version !== journal.journal.marker.adapterVersion
  )
    throw new WorkspaceHostError(
      "host_coordinate_invalid",
      "The cleanup recovery coordinate differs from its private journal.",
    );
  const stored = await readWorkspace(input.coordinates.repositoryRoot, journal.journal.workspaceId);
  if (stored === null || stored.workspace.generation !== journal.journal.generation)
    throw new WorkspaceHostError(
      "host_effect_uncertain",
      "The cleanup workspace record is absent.",
    );
  const inspection = await input.host.inspectCleanup({
    repositoryRoot: input.coordinates.repositoryRoot,
    workspacePath: input.coordinates.workspacePath,
    baseCommit: journal.journal.baseCommit,
    marker: journal.journal.marker,
    integrationTargetRef: input.coordinates.integrationTargetRef,
    integratedHeadCommit: journal.journal.integratedHeadCommit,
  });
  const occurredAt = (input.now ?? new Date()).toISOString();
  if (inspection.status === "absent") {
    let currentJournal = journal;
    if (currentJournal.journal.phase === "prepared")
      currentJournal = await recordWorkspaceCleanupRemoval({
        repositoryRoot: input.coordinates.repositoryRoot,
        journalId: input.journalId,
        expectedContentHash: currentJournal.contentHash,
        observedAt: occurredAt,
      });
    const removed =
      stored.workspace.state === "removed"
        ? stored
        : await updateWorkspace({
            repositoryRoot: input.coordinates.repositoryRoot,
            workspaceId: stored.workspace.workspaceId,
            expectedContentHash: stored.contentHash,
            eventId: derivedEventId(input.journalId, "removed"),
            expectedRevision: stored.workspace.revision,
            expectedGeneration: stored.workspace.generation,
            nextState: "removed",
            occurredAt,
            evidence: { hostAbsent: true, gitMetadataAbsent: true },
            cleanupPlanId: journal.journal.planId,
            reasonCode: "cleanup_recovery_confirmed_absent",
          });
    await clearWorkspaceCleanupJournal({
      repositoryRoot: input.coordinates.repositoryRoot,
      journalId: input.journalId,
      expectedContentHash: currentJournal.contentHash,
    });
    return { status: "removed", workspace: removed.workspace };
  }
  if (
    inspection.status === "present" &&
    inspection.markerMatched &&
    inspection.clean &&
    inspection.gitOperationInProgress === false &&
    ["removing", "recovery_required"].includes(stored.workspace.state)
  ) {
    const eligible = await updateWorkspace({
      repositoryRoot: input.coordinates.repositoryRoot,
      workspaceId: stored.workspace.workspaceId,
      expectedContentHash: stored.contentHash,
      eventId: derivedEventId(input.journalId, "restored"),
      expectedRevision: stored.workspace.revision,
      expectedGeneration: stored.workspace.generation,
      nextState: "cleanup_eligible",
      occurredAt,
      evidence: { cleanupEligible: true },
      cleanupPlanId: journal.journal.planId,
      reasonCode: "cleanup_recovery_restored_eligibility",
    });
    await clearWorkspaceCleanupJournal({
      repositoryRoot: input.coordinates.repositoryRoot,
      journalId: input.journalId,
      expectedContentHash: journal.contentHash,
    });
    return { status: "eligible", workspace: eligible.workspace };
  }
  return { status: "recovery_required", workspace: stored.workspace };
}
