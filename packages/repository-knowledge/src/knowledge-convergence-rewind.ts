import type { ArtifactStore, OutboxStore } from "@lervo/storage-contract";

import { canonicalJson } from "./integrity.js";
import {
  KNOWLEDGE_CONVERGENCE_DESTINATION,
  MAXIMUM_CONVERGENCE_OBLIGATIONS,
  type KnowledgeConvergenceBaseline,
  type KnowledgeConvergenceHost,
} from "./knowledge-convergence-contract.js";
import { KNOWLEDGE_STAGE_FAILURE_EVALUATION_CONTRACT } from "./knowledge-convergence-failure.js";
import type { KnowledgeConvergenceProjection } from "./knowledge-convergence-replay.js";
import { convergenceEventId, queuedConvergenceStage } from "./knowledge-convergence-settlement.js";

/**
 * ADR-0600: how often one obligation may restart after its own effects were undone. While an
 * obligation is open, an owner who deliberately reverts its commit looks exactly like a sync reset,
 * so this cap is what stops Lervo from re-applying work the owner reverted.
 */
export const MAXIMUM_OBLIGATION_REWINDS = 3;

/** The attention an obligation settles with once its effects were undone too often. */
export const KNOWLEDGE_EFFECT_UNDONE_REPEATEDLY = "knowledge_effect_undone_repeatedly";

/**
 * ADR-0600: the repository is back at this obligation's own baseline bytes while its latest stage
 * went stale at a later snapshot, so a reset undid the commits it made. Its id is the one discovery
 * would open again, so the obligation restarts at assessment from its baseline input. After
 * `MAXIMUM_OBLIGATION_REWINDS` restarts it settles as attention instead and records nothing more.
 */
export async function reconcileUndoneObligation(input: {
  events: OutboxStore;
  host: Pick<KnowledgeConvergenceHost, "evaluationContract">;
  artifacts: ArtifactStore;
  rows: readonly KnowledgeConvergenceProjection[];
  obligationId: string;
  baseline: KnowledgeConvergenceBaseline;
  now: Date;
}): Promise<void> {
  const row = input.rows.find((item) => item.baseline.payload.obligationId === input.obligationId);
  const latest = row?.latest ?? null;
  if (
    row === undefined ||
    row.outcome !== null ||
    latest === null ||
    latest.payload.state !== "stale" ||
    latest.payload.snapshotHash === input.baseline.sourceSnapshotHash ||
    row.baseline.payload.sourceSnapshotHash !== input.baseline.sourceSnapshotHash
  )
    return;
  const occurredAt = input.now.toISOString();
  const rewinds = countObligationRewinds(input.events, input.obligationId);
  if (rewinds >= MAXIMUM_OBLIGATION_REWINDS) {
    // Attention needs a dependency (event contract). It is bound to the bytes the repository is at
    // now, so it holds while they stay and any byte change lets discovery supersede the obligation.
    const dependency = await input.artifacts.put(
      canonicalJson({
        schemaVersion: 1,
        kind: "stage_failure",
        code: KNOWLEDGE_EFFECT_UNDONE_REPEATEDLY,
        evaluationContract:
          input.host.evaluationContract ?? KNOWLEDGE_STAGE_FAILURE_EVALUATION_CONTRACT,
        snapshotHash: input.baseline.sourceSnapshotHash,
        delegationHash: input.baseline.delegationHash,
        evidenceHash: null,
        rewinds,
      }),
    );
    input.events.transact((transaction) => {
      transaction.append({
        eventId: convergenceEventId([latest.eventId, KNOWLEDGE_EFFECT_UNDONE_REPEATEDLY]),
        projectId: latest.projectId,
        runId: latest.runId,
        sessionId: latest.sessionId,
        actor: { kind: "system" },
        schemaVersion: 4,
        policyVersion: latest.policyVersion,
        type: "repository.knowledge.stage.recorded",
        occurredAt,
        payload: {
          obligationId: input.obligationId,
          predecessorEventId: latest.eventId,
          predecessorEventHash: latest.eventHash,
          stage: latest.payload.stage,
          state: "attention_required",
          snapshotHash: latest.payload.snapshotHash,
          assignmentId: null,
          leaseGeneration: null,
          attemptCount: latest.payload.attemptCount,
          inputArtifactHash: latest.payload.inputArtifactHash,
          resultArtifactHash: latest.payload.resultArtifactHash,
          nextObligationId: null,
          dependencyHash: dependency.contentHash,
          failureCode: KNOWLEDGE_EFFECT_UNDONE_REPEATEDLY,
          occurredAt,
        },
      });
    });
    return;
  }
  // The evidence marks the queued record as a rewind, so the next one can count it.
  const evidence = await input.artifacts.put(
    canonicalJson({
      schemaVersion: 1,
      kind: "obligation_rewind",
      rewind: rewinds + 1,
      undoneSnapshotHash: latest.payload.snapshotHash,
      baselineSnapshotHash: input.baseline.sourceSnapshotHash,
    }),
  );
  const draft = queuedConvergenceStage({
    predecessor: latest,
    obligationId: input.obligationId,
    stage: "assessment",
    snapshotHash: input.baseline.sourceSnapshotHash,
    inputArtifactHash: row.baseline.payload.inputArtifactHash,
    occurredAt,
    priorAttempts: latest.payload.attemptCount,
  });
  input.events.transact((transaction) => {
    transaction.append({
      ...draft,
      payload: { ...draft.payload, dependencyHash: evidence.contentHash },
    });
    if (
      transaction.outstandingCount(KNOWLEDGE_CONVERGENCE_DESTINATION) <
      MAXIMUM_CONVERGENCE_OBLIGATIONS
    )
      transaction.enqueue({
        eventId: draft.eventId,
        destinationId: KNOWLEDGE_CONVERGENCE_DESTINATION,
        enqueuedAt: occurredAt,
      });
  });
}

/**
 * Rewinds this obligation already made. A rewind is its only queued stage record that names a
 * dependency: other queued handoffs carry none. Discovery reads this only when a rewind is due.
 */
function countObligationRewinds(events: OutboxStore, obligationId: string): number {
  let count = 0;
  let afterSeq = 0;
  for (;;) {
    const page = events.list({
      afterSeq,
      limit: 1_000,
      types: ["repository.knowledge.stage.recorded"],
    });
    if (page.length === 0) return count;
    for (const event of page) {
      afterSeq = event.seq;
      const payload = event.payload as {
        obligationId?: unknown;
        state?: unknown;
        dependencyHash?: unknown;
      };
      if (
        event.type === "repository.knowledge.stage.recorded" &&
        payload.obligationId === obligationId &&
        payload.state === "queued" &&
        typeof payload.dependencyHash === "string"
      )
        count++;
    }
  }
}
