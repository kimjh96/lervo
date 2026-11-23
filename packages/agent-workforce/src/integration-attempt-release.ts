import { randomBytes } from "node:crypto";

import { RepositoryCoordinationRecords } from "@lervo/project-storage";

import { listAssignments } from "./assignment-state.js";
import {
  isWorkspaceIntegrationAttempt,
  validWorkspaceIntegrationTime,
  workspaceIntegrationAttemptEvent,
} from "./integration-attempt-contract.js";
import {
  listWorkspaceIntegrationAttempts,
  readWorkspaceIntegrationAttempt,
} from "./integration-attempt-store.js";
import type { WorkspaceIntegrationAttempt } from "./integration-attempt-types.js";
import { AgentWorkforceError, type WorkforceAssignment } from "./types.js";
import { readWorkspace, updateWorkspace } from "./workspace-store.js";

const RELEASABLE_STATES: readonly string[] = ["leased", "candidate", "conflict"];

function refuse(message: string): never {
  throw new AgentWorkforceError("workspace_transition_conflict", message);
}

/**
 * The lease that created an attempt is still live while its assignment holds an unexpired lease
 * acquired no later than the attempt. Renewal keeps `acquiredAt`; a reclaim or a reopened retry
 * replaces it, and an expired lease can no longer act.
 */
function creatingLeaseLive(
  attempt: WorkspaceIntegrationAttempt,
  assignment: WorkforceAssignment | undefined,
  at: string,
): boolean {
  return (
    assignment?.status === "leased" &&
    assignment.lease !== null &&
    Date.parse(assignment.lease.acquiredAt) <= Date.parse(attempt.createdAt) &&
    Date.parse(assignment.lease.expiresAt) > Date.parse(at)
  );
}

/**
 * Ends a `leased`, `candidate` or `conflict` attempt whose effect never reached its target, so its
 * target generation stops blocking the next one. A recorded candidate must be neither the target
 * ref nor one of its ancestors; the ref may otherwise have moved, for example by synchronization.
 * The creating lease must have ended unless that lease releases its own attempt. The target only
 * moves to a candidate after `advancing` is recorded under this record's compare-and-swap, so the
 * observation cannot be overtaken; `advancing` and `integrated` attempts are never released. The
 * attempt's sources then return to their integration queue.
 */
export async function releaseWorkspaceIntegrationAttempt(input: {
  repositoryRoot: string;
  targetLeaseId: string;
  expectedContentHash: string;
  expectedRevision: number;
  eventId: string;
  occurredAt: string;
  /** The creating lease releasing its own attempt; absent, that lease must have ended. */
  holderLeaseId?: string;
  /** Whether the target ref names this candidate commit or descends from it. */
  candidateReachedTarget: (candidateCommit: string) => Promise<boolean>;
}): Promise<{ attempt: WorkspaceIntegrationAttempt; contentHash: string }> {
  const current = await readWorkspaceIntegrationAttempt(input.repositoryRoot, input.targetLeaseId);
  if (
    current === null ||
    current.contentHash !== input.expectedContentHash ||
    current.attempt.revision !== input.expectedRevision ||
    !validWorkspaceIntegrationTime(input.occurredAt)
  )
    refuse("The integration attempt changed before release.");
  if (!RELEASABLE_STATES.includes(current.attempt.state))
    refuse(`The integration attempt is ${current.attempt.state} and cannot be released.`);
  const assignment = (await listAssignments(input.repositoryRoot)).find(
    (item) => item.assignmentId === current.attempt.integrationAssignmentId,
  );
  if (
    creatingLeaseLive(current.attempt, assignment, input.occurredAt) &&
    assignment!.lease!.leaseId !== input.holderLeaseId
  )
    refuse("The lease that created the integration attempt is still live.");
  if (
    current.attempt.candidateCommit !== null &&
    (await input.candidateReachedTarget(current.attempt.candidateCommit))
  )
    refuse("The integration candidate reached its target.");
  const next: WorkspaceIntegrationAttempt = {
    ...current.attempt,
    state: "released",
    revision: current.attempt.revision + 1,
    updatedAt: input.occurredAt,
  };
  if (!isWorkspaceIntegrationAttempt(next))
    throw new AgentWorkforceError("workspace_invalid", "The released attempt is invalid.");
  const records = await RepositoryCoordinationRecords.open(input.repositoryRoot);
  const stored = await records.writeTransition({
    collection: "integrationAttempts",
    recordId: input.targetLeaseId,
    value: next,
    expectedContentHash: current.contentHash,
    eventId: input.eventId,
    event: workspaceIntegrationAttemptEvent({
      eventId: input.eventId,
      current: current.attempt,
      next,
    }),
  });
  await requeueReleasedIntegrationSources({
    repositoryRoot: input.repositoryRoot,
    targetLeaseId: input.targetLeaseId,
    occurredAt: input.occurredAt,
  });
  return { attempt: structuredClone(stored.value), contentHash: stored.contentHash };
}

/**
 * Returns a released attempt's `integrating` sources to their committed queue entries, so a new
 * plan can select them again. A source stays put while any unreleased attempt names it or when its
 * generation or sealed head no longer matches. Sources are read before attempts: an attempt is
 * always acquired before it starts its sources, and the workspace compare-and-swap covers the
 * rest. Idempotent: a retry finishes an interrupted requeue, and lists attempts only when a source
 * is still `integrating`.
 */
export async function requeueReleasedIntegrationSources(input: {
  repositoryRoot: string;
  targetLeaseId: string;
  occurredAt: string;
}): Promise<number> {
  const released = await readWorkspaceIntegrationAttempt(input.repositoryRoot, input.targetLeaseId);
  if (released?.attempt.state !== "released") return 0;
  const integrating = [];
  for (const source of released.attempt.sources) {
    const stored = await readWorkspace(input.repositoryRoot, source.workspaceId);
    if (
      stored?.workspace.state === "integrating" &&
      stored.workspace.generation === source.generation &&
      stored.workspace.sealedResult?.headCommit === source.headCommit &&
      stored.workspace.integrationQueueEntryId !== null
    )
      integrating.push({ source, stored, queueEntryId: stored.workspace.integrationQueueEntryId });
  }
  if (integrating.length === 0) return 0;
  const attempts = await listWorkspaceIntegrationAttempts(input.repositoryRoot);
  let requeued = 0;
  for (const { source, stored, queueEntryId } of integrating) {
    if (
      attempts.some(
        (attempt) =>
          attempt.state !== "released" &&
          attempt.sources.some(
            (item) =>
              item.workspaceId === source.workspaceId && item.generation === source.generation,
          ),
      )
    )
      continue;
    await updateWorkspace({
      repositoryRoot: input.repositoryRoot,
      workspaceId: source.workspaceId,
      expectedContentHash: stored.contentHash,
      eventId: `evt_${randomBytes(12).toString("hex")}`,
      expectedRevision: stored.workspace.revision,
      expectedGeneration: source.generation,
      nextState: "integration_pending",
      occurredAt: input.occurredAt,
      evidence: { queueEntryCommitted: true, integrationReleased: true },
      integrationQueueEntryId: queueEntryId,
      reasonCode: "integration_attempt_released",
    });
    requeued += 1;
  }
  return requeued;
}
