import type { OutboxDelivery, OutboxStore } from "@lervo/storage-contract";

import { sha256 } from "./integrity.js";
import {
  REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION,
  type RepositoryChangeSourceKind,
} from "./repository-change-source.js";
import { assertRepositoryKnowledgeJobLease } from "./repository-knowledge-job-lease.js";
import type {
  RepositoryKnowledgeIntakeSummary,
  TerminalOutcome,
} from "./repository-knowledge-worker-contract.js";

export const MAXIMUM_REPOSITORY_KNOWLEDGE_ATTEMPTS = 16;

function resolutionEventId(changeEventId: string, destinationId: string): string {
  const identity =
    destinationId === REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION
      ? `repository.knowledge.resolved\0${changeEventId}`
      : `repository.knowledge.resolved\0${changeEventId}\0${destinationId}`;
  return `evt_${sha256(identity).slice(7, 39)}`;
}

/**
 * Appends the one resolution for this delivery and acknowledges its lease in the same commit. A
 * re-queued delivery records a successor resolution that names the one it supersedes.
 */
export function settleRepositoryKnowledgeJob(input: {
  events: OutboxStore;
  delivery: OutboxDelivery;
  workerId: string;
  outcome: TerminalOutcome;
  intake: RepositoryKnowledgeIntakeSummary;
  resolvedAt: string;
}): void {
  const { delivery, outcome, intake, resolvedAt } = input;
  const change = delivery.event;
  const requeued = delivery.destinationId !== REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION;
  input.events.transact((transaction) => {
    assertRepositoryKnowledgeJobLease({
      events: input.events,
      delivery,
      now: new Date(resolvedAt),
    });
    transaction.append({
      eventId: resolutionEventId(change.eventId, delivery.destinationId),
      projectId: change.projectId,
      runId: change.runId,
      sessionId: change.sessionId,
      occurredAt: resolvedAt,
      actor: { kind: "system" },
      schemaVersion: 3,
      policyVersion: change.policyVersion,
      type: "repository.knowledge.resolved",
      payload: {
        changeEventId: change.eventId,
        changeEventHash: change.eventHash,
        sourceKind: (change.payload as { sourceKind: RepositoryChangeSourceKind }).sourceKind,
        terminalState: outcome.terminalState,
        classification: outcome.classification,
        attemptCount: Math.min(delivery.attemptCount, MAXIMUM_REPOSITORY_KNOWLEDGE_ATTEMPTS),
        failureCode: outcome.failureCode,
        knowledgeSnapshotHash: outcome.knowledgeSnapshotHash,
        canonicalizationCandidateId: outcome.canonicalizationCandidateId,
        skippedPathCount: intake.skippedPathCount,
        skippedReasons: intake.skippedReasons,
        subJobIndex: intake.subJobIndex,
        subJobCount: intake.subJobCount,
        ...(requeued
          ? {
              supersedesResolutionEventId: resolutionEventId(
                change.eventId,
                REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION,
              ),
            }
          : {}),
        resolvedAt,
      },
    });
    // The outcome and the acknowledgement share one commit; a lost lease rolls both back.
    if (
      !transaction.acknowledge({
        eventId: change.eventId,
        destinationId: delivery.destinationId,
        workerId: input.workerId,
        acknowledgedAt: resolvedAt,
      }).acknowledged
    )
      throw new Error("The repository knowledge job lease was lost before settlement.");
  });
}
