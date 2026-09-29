import type { EventDraftV4 } from "@lervo/event-contract";
import type {
  KnowledgeConvergenceStage,
  RepositoryKnowledgeStageRecordedEventPayload,
} from "@lervo/schemas";
import type { OutboxDelivery, OutboxStore } from "@lervo/storage-contract";

import { canonicalJson, sha256, stableId } from "./integrity.js";
import {
  KNOWLEDGE_CONVERGENCE_DESTINATION,
  MAXIMUM_CONVERGENCE_OBLIGATIONS,
  type KnowledgeConvergenceInput,
  type KnowledgeConvergenceStageResult,
} from "./knowledge-convergence-contract.js";
import { assertRepositoryKnowledgeJobLease } from "./repository-knowledge-job-lease.js";
import type { KnowledgeConvergenceProjection } from "./knowledge-convergence-replay.js";

export function convergenceEventId(material: unknown): string {
  return stableId("evt", material, 32);
}

export function queuedConvergenceStage(input: {
  predecessor: OutboxDelivery["event"];
  obligationId: string;
  stage: KnowledgeConvergenceStage;
  snapshotHash: string;
  inputArtifactHash: string;
  occurredAt: string;
}): EventDraftV4 {
  return {
    eventId: convergenceEventId([input.predecessor.eventId, input.stage, "queued"]),
    projectId: input.predecessor.projectId,
    runId: input.predecessor.runId,
    sessionId: input.predecessor.sessionId,
    occurredAt: input.occurredAt,
    actor: { kind: "system" },
    schemaVersion: 4,
    policyVersion: input.predecessor.policyVersion,
    type: "repository.knowledge.stage.recorded",
    payload: {
      obligationId: input.obligationId,
      predecessorEventId: input.predecessor.eventId,
      predecessorEventHash: input.predecessor.eventHash,
      stage: input.stage,
      state: "queued",
      snapshotHash: input.snapshotHash,
      assignmentId: null,
      leaseGeneration: null,
      attemptCount: 0,
      inputArtifactHash: input.inputArtifactHash,
      resultArtifactHash: null,
      nextObligationId: input.obligationId,
      dependencyHash: null,
      failureCode: null,
      occurredAt: input.occurredAt,
    } satisfies RepositoryKnowledgeStageRecordedEventPayload,
  };
}

/** Stage result, successor job, and exact acknowledgement commit together. */
export function settleKnowledgeConvergenceStage(input: {
  events: OutboxStore;
  delivery: OutboxDelivery;
  row: KnowledgeConvergenceProjection;
  workerId: string;
  stage: KnowledgeConvergenceStage;
  result: KnowledgeConvergenceStageResult;
  resultArtifactHash: string;
  now: Date;
  assertSettlement(): void;
}): void {
  const { result, delivery, row } = input;
  const occurredAt = input.now.toISOString();
  const source = delivery.event;
  input.events.transact((transaction) => {
    assertRepositoryKnowledgeJobLease({ events: input.events, delivery, now: input.now });
    if (result.state === "current") input.assertSettlement();
    if (result.state === "current" && result.nextStage === null) {
      assertKnowledgeConvergenceComplete(result.input, result.knowledgeSnapshotHash);
      transaction.append({
        eventId: convergenceEventId([row.baseline.payload.obligationId, "terminal"]),
        projectId: source.projectId,
        runId: source.runId,
        sessionId: source.sessionId,
        actor: { kind: "system" },
        schemaVersion: 4,
        policyVersion: source.policyVersion,
        type: "repository.knowledge.convergence.recorded",
        occurredAt,
        payload: {
          obligationId: row.baseline.payload.obligationId,
          originalEventId: row.baseline.eventId,
          originalEventHash: row.baseline.eventHash,
          scope: "baseline",
          terminalState: "current",
          snapshotHash: result.input.snapshotHash,
          canonicalDispositionDigest: receiptDigest(result.input, [
            "assessment",
            "canonical_review",
            "canonical_integration",
          ]),
          normalizationCoverageDigest: receiptDigest(result.input, [
            "normalization_generation",
            "normalization_review",
            "normalization_apply",
          ]),
          lifecycleReceiptDigest: input.resultArtifactHash,
          knowledgeSnapshotHash: result.knowledgeSnapshotHash!,
          successorId: null,
          failureCode: null,
          resolvedAt: occurredAt,
        },
      });
    } else {
      const recorded = transaction.append({
        eventId: convergenceEventId([
          source.eventId,
          delivery.attemptCount,
          result.state,
          input.resultArtifactHash,
        ]),
        projectId: source.projectId,
        runId: source.runId,
        sessionId: source.sessionId,
        actor: { kind: "system" },
        schemaVersion: 4,
        policyVersion: source.policyVersion,
        type: "repository.knowledge.stage.recorded",
        occurredAt,
        payload: {
          obligationId: row.baseline.payload.obligationId,
          predecessorEventId: source.eventId,
          predecessorEventHash: source.eventHash,
          stage: input.stage,
          state: result.state,
          snapshotHash: result.input.snapshotHash,
          assignmentId: result.assignmentId,
          leaseGeneration: result.leaseGeneration,
          attemptCount: Math.min(16, delivery.attemptCount),
          inputArtifactHash: (source.payload as { inputArtifactHash: string }).inputArtifactHash,
          resultArtifactHash: input.resultArtifactHash,
          nextObligationId: result.nextStage === null ? null : row.baseline.payload.obligationId,
          dependencyHash: result.dependencyHash,
          failureCode: result.failureCode,
          occurredAt,
        },
      });
      if (result.nextStage !== null && result.state === "current") {
        const next = queuedConvergenceStage({
          predecessor: recorded.event,
          obligationId: row.baseline.payload.obligationId,
          stage: result.nextStage,
          snapshotHash: result.input.snapshotHash,
          inputArtifactHash: input.resultArtifactHash,
          occurredAt,
        });
        transaction.append(next);
        if (
          transaction.outstandingCount(KNOWLEDGE_CONVERGENCE_DESTINATION) <=
          MAXIMUM_CONVERGENCE_OBLIGATIONS
        )
          transaction.enqueue({
            eventId: next.eventId,
            destinationId: KNOWLEDGE_CONVERGENCE_DESTINATION,
            enqueuedAt: occurredAt,
          });
      }
    }
    if (
      !transaction.acknowledge({
        eventId: source.eventId,
        destinationId: KNOWLEDGE_CONVERGENCE_DESTINATION,
        workerId: input.workerId,
        acknowledgedAt: occurredAt,
      }).acknowledged
    )
      throw new Error("The convergence lease was lost before handoff.");
  });
}

function receiptDigest(
  input: KnowledgeConvergenceInput,
  stages: KnowledgeConvergenceStage[],
): string {
  return sha256(canonicalJson(input.receipts.filter((receipt) => stages.includes(receipt.stage))));
}

function assertKnowledgeConvergenceComplete(
  input: KnowledgeConvergenceInput,
  snapshotHash: string | undefined,
): void {
  const required: KnowledgeConvergenceStage[] = [
    "assessment",
    "canonical_review",
    "canonical_integration",
    "normalization_generation",
    "normalization_review",
    "normalization_apply",
    "lifecycle_verification",
  ];
  if (
    snapshotHash === undefined ||
    !/^sha256:[a-f0-9]{64}$/u.test(snapshotHash) ||
    required.some((stage) => !input.receipts.some((receipt) => receipt.stage === stage)) ||
    input.receipts.at(-1)?.snapshotHash !== input.snapshotHash
  )
    throw new Error(
      "Knowledge convergence requires every stage and the exact final verified snapshot.",
    );
}
