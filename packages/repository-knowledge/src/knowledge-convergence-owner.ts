import { convergenceStatus } from "./knowledge-convergence-status.js";
import { assertKnowledgeConvergenceInput } from "./knowledge-convergence-input.js";
import {
  convergenceRetryLimit,
  KNOWLEDGE_STAGE_FAILURE_EVALUATION_CONTRACT,
  MAXIMUM_CONVERGENCE_STAGE_ATTEMPTS,
  normalizedConvergenceFailure,
  UNCLASSIFIED_STAGE_REEVALUATION_MS,
} from "./knowledge-convergence-failure.js";
import type { KnowledgeConvergenceStage } from "@lervo/schemas";
import type { ArtifactStore, OutboxStore } from "@lervo/storage-contract";

import { canonicalJson, sha256 } from "./integrity.js";
import { assertRepositoryKnowledgeJobLease } from "./repository-knowledge-job-lease.js";
import {
  KNOWLEDGE_CONVERGENCE_DESTINATION,
  MAXIMUM_CONVERGENCE_OBLIGATIONS,
  type KnowledgeConvergenceHost,
  type KnowledgeConvergenceInput,
  type KnowledgeConvergenceStageResult,
  type KnowledgeConvergenceStatus,
} from "./knowledge-convergence-contract.js";
import {
  memoizedKnowledgeConvergenceReplay,
  reconcileKnowledgeConvergenceOutbox,
  type KnowledgeConvergenceProjection,
} from "./knowledge-convergence-replay.js";
import { discoverKnowledgeConvergenceObligation } from "./knowledge-convergence-discovery.js";
import {
  convergenceEventId,
  queuedConvergenceStage,
  settleKnowledgeConvergenceStage,
} from "./knowledge-convergence-settlement.js";

async function loadInput(
  artifacts: ArtifactStore,
  hash: string,
  projectId: string,
  obligationId: string,
): Promise<KnowledgeConvergenceInput> {
  if (!/^sha256:[a-f0-9]{64}$/u.test(hash))
    throw new Error("The convergence input coordinate is invalid.");
  const bytes = await artifacts.get(`lervo-cas://sha256/${hash.slice(7)}`);
  if (bytes.byteLength > 16 * 1024 * 1024 || sha256(bytes) !== hash)
    throw new Error("The convergence input artifact is invalid.");
  const value = JSON.parse(
    new TextDecoder("utf8", { fatal: true }).decode(bytes),
  ) as KnowledgeConvergenceInput;
  if (
    value.schemaVersion !== 1 ||
    value.obligationId !== obligationId ||
    value.baseline?.projectId !== projectId ||
    !Array.isArray(value.receipts) ||
    value.stageData === null ||
    typeof value.stageData !== "object"
  )
    throw new Error("The convergence input identity is invalid.");
  return value;
}

async function resumeDependencies(
  input: OwnerInput,
  now: Date,
  replay: () => KnowledgeConvergenceProjection[],
): Promise<void> {
  for (const row of replay()) {
    if (
      row.outcome !== null ||
      row.latest === null ||
      row.latest.payload.dependencyHash === null ||
      row.latest.payload.state === "queued"
    )
      continue;
    if (await input.host.dependencyCurrent(row.latest.payload.dependencyHash)) continue;
    const hash = row.latest.payload.resultArtifactHash ?? row.latest.payload.inputArtifactHash;
    if (hash === null) continue;
    const draft = queuedConvergenceStage({
      predecessor: row.latest,
      obligationId: row.baseline.payload.obligationId,
      stage: row.latest.payload.stage,
      snapshotHash: row.latest.payload.snapshotHash,
      inputArtifactHash: hash,
      occurredAt: now.toISOString(),
    });
    input.events.transact((transaction) => {
      transaction.append(draft);
      if (
        transaction.outstandingCount(KNOWLEDGE_CONVERGENCE_DESTINATION) <
        MAXIMUM_CONVERGENCE_OBLIGATIONS
      )
        transaction.enqueue({
          eventId: draft.eventId,
          destinationId: KNOWLEDGE_CONVERGENCE_DESTINATION,
          enqueuedAt: now.toISOString(),
        });
    });
  }
}

interface OwnerInput {
  events: OutboxStore;
  artifacts: ArtifactStore;
  workerId: string;
  writableEventSchemaVersion: number;
  host: KnowledgeConvergenceHost;
  now?: () => Date;
  maximumStages?: number;
}

/** Startup, event wakeups, and the idle timer use this same provider-neutral durable owner. */
export async function processKnowledgeConvergence(
  input: OwnerInput,
): Promise<KnowledgeConvergenceStatus> {
  const now = input.now ?? (() => new Date());
  if (
    !Number.isSafeInteger(input.maximumStages ?? 8) ||
    (input.maximumStages ?? 8) < 1 ||
    (input.maximumStages ?? 8) > 8
  )
    throw new Error("The convergence stage budget is invalid.");
  if (input.writableEventSchemaVersion < 4)
    return convergenceStatus(
      input,
      await input.host.discover(),
      now(),
      "reader_transition_required",
    );
  const replay = memoizedKnowledgeConvergenceReplay(input.events);
  const baseline = await discoverKnowledgeConvergenceObligation(input, now(), replay);
  const discoveredHead = input.events.latest()?.eventHash ?? null;
  let deliveries = 0;
  // Canonical stage handoffs survive pruning their acknowledged scheduling projections.
  input.events.purgeAcknowledged({
    destinationId: KNOWLEDGE_CONVERGENCE_DESTINATION,
    before: new Date(now().getTime() - 7 * 24 * 60 * 60_000).toISOString(),
    keepMostRecent: 1_024,
    limit: 1_000,
  });
  await resumeDependencies(input, now(), replay);
  reconcileKnowledgeConvergenceOutbox(input.events, replay(), now().toISOString());
  for (let index = 0; index < (input.maximumStages ?? 8); index++) {
    const [delivery] = input.events.claim({
      workerId: input.workerId,
      destinationId: KNOWLEDGE_CONVERGENCE_DESTINATION,
      claimedAt: now().toISOString(),
      leaseDurationMs: 60 * 60_000,
      limit: 1,
    });
    if (delivery === undefined) break;
    deliveries++;
    const row = replay().find(
      (item) => item.baseline.payload.obligationId === delivery.event.payload.obligationId,
    );
    const terminal = input.events.get(
      convergenceEventId([delivery.event.payload.obligationId, "terminal"]),
    );
    if (terminal?.type === "repository.knowledge.convergence.recorded") {
      input.events.transact((transaction) => {
        assertRepositoryKnowledgeJobLease({ events: input.events, delivery, now: now() });
        transaction.acknowledge({
          eventId: delivery.event.eventId,
          destinationId: KNOWLEDGE_CONVERGENCE_DESTINATION,
          workerId: input.workerId,
          acknowledgedAt: now().toISOString(),
        });
      });
      continue;
    }
    if (row === undefined)
      throw new Error("The convergence continuation has no canonical baseline.");
    if ((row.latest ?? row.baseline).eventId !== delivery.event.eventId)
      throw new Error("The convergence continuation disagrees with canonical history.");
    const stage: KnowledgeConvergenceStage =
      delivery.event.type === "repository.knowledge.baseline.requested"
        ? "assessment"
        : (delivery.event.payload as { stage: KnowledgeConvergenceStage }).stage;
    const state = await loadInput(
      input.artifacts,
      delivery.event.payload.inputArtifactHash as string,
      delivery.event.projectId,
      row.baseline.payload.obligationId,
    );
    const assertLease = () =>
      assertRepositoryKnowledgeJobLease({ events: input.events, delivery, now: now() });
    assertLease();
    let result: KnowledgeConvergenceStageResult;
    try {
      await assertKnowledgeConvergenceInput({
        value: state,
        baseline: row.baseline,
        artifacts: input.artifacts,
      });
      await input.host.assertCurrent(state);
      assertLease();
      if (delivery.attemptCount > MAXIMUM_CONVERGENCE_STAGE_ATTEMPTS)
        throw Object.assign(new Error("Retry ceiling reached."), {
          code: "knowledge_retry_exhausted",
        });
      result = await input.host.runStage(stage, state, assertLease);
      assertLease();
      await assertKnowledgeConvergenceInput({
        value: result.input,
        baseline: row.baseline,
        artifacts: input.artifacts,
        expectedBaseline: state.baseline,
      });
      await input.host.assertCurrent(result.input);
      assertLease();
    } catch (error) {
      assertLease();
      const code = normalizedConvergenceFailure(error);
      const retryLimit = convergenceRetryLimit(code);
      if (retryLimit !== null && delivery.attemptCount < retryLimit) {
        const delay = Math.min(60 * 60_000, 60_000 * 2 ** (delivery.attemptCount - 1));
        input.events.reschedule({
          eventId: delivery.event.eventId,
          destinationId: KNOWLEDGE_CONVERGENCE_DESTINATION,
          workerId: input.workerId,
          failedAt: now().toISOString(),
          availableAt: new Date(now().getTime() + delay).toISOString(),
          failureCode: code,
        });
        break;
      }
      const dependency = await input.artifacts.put(
        canonicalJson({
          schemaVersion: 1,
          kind: "stage_failure",
          code,
          evaluationContract: KNOWLEDGE_STAGE_FAILURE_EVALUATION_CONTRACT,
          snapshotHash: state.snapshotHash,
          delegationHash: state.baseline.delegationHash,
          evidenceHash: /^sha256:[a-f0-9]{64}$/u.test(
            String((error as { dependencyHash?: unknown })?.dependencyHash),
          )
            ? (error as { dependencyHash: string }).dependencyHash
            : null,
          ...(code === "knowledge_stage_failure_unclassified"
            ? {
                reevaluateAt: new Date(
                  now().getTime() + UNCLASSIFIED_STAGE_REEVALUATION_MS,
                ).toISOString(),
              }
            : {}),
        }),
      );
      result = {
        state:
          code === "source_bytes_changed"
            ? "stale"
            : [
                  "knowledge_effect_uncertain",
                  "host_effect_uncertain",
                  "knowledge_recovery_required",
                  "knowledge_recovery_busy",
                  "knowledge_recovery_invalid",
                  "knowledge_rollback_failed",
                ].includes(code)
              ? "recovery_required"
              : [
                    "knowledge_authority_unavailable",
                    "knowledge_provider_paused",
                    "knowledge_capacity_unavailable",
                    "assignment_path_conflict",
                  ].includes(code)
                ? "waiting_authority"
                : "attention_required",
        input: state,
        assignmentId: null,
        leaseGeneration: null,
        failureCode:
          delivery.attemptCount >= MAXIMUM_CONVERGENCE_STAGE_ATTEMPTS
            ? "knowledge_retry_exhausted"
            : code,
        dependencyHash: dependency.contentHash,
        nextStage: null,
      };
    }
    const stored = await input.artifacts.put(canonicalJson(result.input));
    assertLease();
    if (result.state === "current") input.host.assertSettlement(result.input);
    settleKnowledgeConvergenceStage({
      events: input.events,
      delivery,
      row,
      workerId: input.workerId,
      stage,
      result,
      resultArtifactHash: stored.contentHash,
      now: now(),
      assertSettlement: () => input.host.assertSettlement(result.input),
    });
  }
  // Without a delivery or a durable append, the opening observation still describes this cycle.
  const unchanged =
    deliveries === 0 && (input.events.latest()?.eventHash ?? null) === discoveredHead;
  return convergenceStatus(
    input,
    unchanged ? baseline : await input.host.discover(),
    now(),
    "ready",
    replay(),
  );
}

/** Read-only status never creates a baseline, a provider call or document effect. */
export function inspectKnowledgeConvergenceStatus(input: {
  events: OutboxStore;
  baseline: Awaited<ReturnType<KnowledgeConvergenceHost["discover"]>>;
  writableEventSchemaVersion: number;
  now?: Date;
}): KnowledgeConvergenceStatus {
  return convergenceStatus(
    input,
    input.baseline,
    input.now ?? new Date(),
    input.writableEventSchemaVersion < 4 ? "reader_transition_required" : "ready",
  );
}
