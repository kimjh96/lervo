import type { ArtifactStore, OutboxStore } from "@lervo/storage-contract";

import { canonicalJson, sha256, stableId } from "./integrity.js";
import {
  KNOWLEDGE_CONVERGENCE_DESTINATION,
  MAXIMUM_CONVERGENCE_OBLIGATIONS,
  type KnowledgeConvergenceBaseline,
  type KnowledgeConvergenceHost,
  type KnowledgeConvergenceInput,
} from "./knowledge-convergence-contract.js";
import type { KnowledgeConvergenceProjection } from "./knowledge-convergence-replay.js";
import { convergenceEventId } from "./knowledge-convergence-settlement.js";

/**
 * Opens at most one obligation for the observed baseline and supersedes every older open one in
 * the same transaction. A current or already open matching obligation records nothing.
 */
export async function discoverKnowledgeConvergenceObligation(
  input: {
    events: OutboxStore;
    artifacts: ArtifactStore;
    host: KnowledgeConvergenceHost;
  },
  now: Date,
  replay: () => KnowledgeConvergenceProjection[],
): Promise<KnowledgeConvergenceBaseline> {
  const baseline = await input.host.discover();
  const rows = replay();
  const lastCurrent = rows.findLast((row) => row.outcome?.payload.terminalState === "current");
  if (
    lastCurrent?.outcome?.payload.snapshotHash === baseline.sourceSnapshotHash &&
    lastCurrent.baseline.payload.policyHash === baseline.policyHash &&
    lastCurrent.baseline.payload.delegationHash === baseline.delegationHash &&
    Object.values(baseline.debtCounts).every((count) => count === 0)
  )
    return baseline;
  const existing = rows.find(
    (row) =>
      row.outcome === null &&
      (row.latest?.payload.snapshotHash ?? row.baseline.payload.sourceSnapshotHash) ===
        baseline.sourceSnapshotHash &&
      row.baseline.payload.policyHash === baseline.policyHash &&
      row.baseline.payload.delegationHash === baseline.delegationHash,
  );
  if (existing !== undefined) return baseline;
  if (rows.filter((row) => row.outcome === null).length >= MAXIMUM_CONVERGENCE_OBLIGATIONS)
    return baseline;
  const obligationId = stableId("kconv", {
    projectId: baseline.projectId,
    snapshot: baseline.sourceSnapshotHash,
    policy: baseline.policyHash,
    debt: baseline.debtDigest,
    delegation: baseline.delegationHash,
  });
  const eventId = convergenceEventId([obligationId, "baseline"]);
  if (input.events.get(eventId) !== null) return baseline;
  const state: KnowledgeConvergenceInput = {
    schemaVersion: 1,
    obligationId,
    baseline,
    snapshotHash: baseline.sourceSnapshotHash,
    receipts: [],
    stageData: {},
  };
  const artifact = await input.artifacts.put(canonicalJson(state));
  await input.host.assertCurrent(state);
  input.events.transact((transaction) => {
    input.host.assertSettlement(state);
    transaction.append({
      eventId,
      projectId: baseline.projectId,
      runId: `run_${sha256(obligationId).slice(7, 39)}`,
      sessionId: `ses_${sha256(`session:${obligationId}`).slice(7, 39)}`,
      actor: { kind: "system" },
      schemaVersion: 4,
      policyVersion: baseline.policyHash,
      type: "repository.knowledge.baseline.requested",
      occurredAt: now.toISOString(),
      payload: {
        obligationId,
        sourceSnapshotId: baseline.sourceSnapshotId,
        sourceSnapshotHash: baseline.sourceSnapshotHash,
        policyHash: baseline.policyHash,
        debtDigest: baseline.debtDigest,
        delegationHash: baseline.delegationHash,
        debtCounts: baseline.debtCounts,
        inputArtifactHash: artifact.contentHash,
        requestedAt: now.toISOString(),
      },
    });
    if (
      transaction.outstandingCount(KNOWLEDGE_CONVERGENCE_DESTINATION) <
      MAXIMUM_CONVERGENCE_OBLIGATIONS
    )
      transaction.enqueue({
        eventId,
        destinationId: KNOWLEDGE_CONVERGENCE_DESTINATION,
        enqueuedAt: now.toISOString(),
      });
    for (const previous of rows.filter((row) => row.outcome === null)) {
      transaction.append({
        eventId: convergenceEventId([previous.baseline.payload.obligationId, "terminal"]),
        projectId: baseline.projectId,
        runId: previous.baseline.runId,
        sessionId: previous.baseline.sessionId,
        actor: { kind: "system" },
        schemaVersion: 4,
        policyVersion: baseline.policyHash,
        type: "repository.knowledge.convergence.recorded",
        occurredAt: now.toISOString(),
        payload: {
          obligationId: previous.baseline.payload.obligationId,
          originalEventId: previous.baseline.eventId,
          originalEventHash: previous.baseline.eventHash,
          scope: "baseline",
          terminalState: "superseded",
          snapshotHash:
            previous.latest?.payload.snapshotHash ?? previous.baseline.payload.sourceSnapshotHash,
          canonicalDispositionDigest: sha256("superseded"),
          normalizationCoverageDigest: sha256("superseded"),
          lifecycleReceiptDigest: sha256("superseded"),
          knowledgeSnapshotHash: null,
          successorId: obligationId,
          failureCode: "source_bytes_changed",
          resolvedAt: now.toISOString(),
        },
      });
    }
  });
  return baseline;
}
