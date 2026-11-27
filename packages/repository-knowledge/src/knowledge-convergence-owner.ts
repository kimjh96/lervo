import { convergenceStatus } from "./knowledge-convergence-status.js";
import { assertKnowledgeConvergenceInput } from "./knowledge-convergence-input.js";
import {
  convergenceRetryLimit,
  convergenceStageFailureRecord,
  MAXIMUM_CONVERGENCE_STAGE_ATTEMPTS,
  normalizedConvergenceFailure,
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
import { costScopedConvergenceHost } from "./knowledge-convergence-cost-scope.js";
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
  discoveredSnapshotHash: string,
): Promise<void> {
  for (const row of replay()) {
    if (
      row.outcome !== null ||
      row.latest === null ||
      row.latest.payload.dependencyHash === null ||
      row.latest.payload.state === "queued"
    )
      continue;
    // ADR-0600: a stage that went stale reruns only once the repository is back at the bytes it
    // was bound to. At any other snapshot it would fail the same way, so discovery either opens a
    // successor or rewinds an obligation whose own effects were undone.
    const stale = row.latest.payload.state === "stale";
    if (stale) {
      if (row.latest.payload.snapshotHash !== discoveredSnapshotHash) continue;
    } else if (await input.host.dependencyCurrent(row.latest.payload.dependencyHash)) continue;
    const hash = row.latest.payload.resultArtifactHash ?? row.latest.payload.inputArtifactHash;
    if (hash === null) continue;
    const draft = queuedConvergenceStage({
      predecessor: row.latest,
      obligationId: row.baseline.payload.obligationId,
      stage: row.latest.payload.stage,
      snapshotHash: row.latest.payload.snapshotHash,
      inputArtifactHash: hash,
      occurredAt: now.toISOString(),
      ...(stale ? { priorAttempts: row.latest.payload.attemptCount } : {}),
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
  /**
   * ADR-0485: asked between stages. When it returns true, this cycle stops after the stages it
   * already ran, so another repository waiting for the host's full-cycle admission takes its turn.
   */
  shouldYield?: () => boolean | Promise<boolean>;
}

/** Startup, event wakeups, and the idle timer use this same provider-neutral durable owner. */
export async function processKnowledgeConvergence(
  input: OwnerInput,
): Promise<KnowledgeConvergenceStatus> {
  const now = input.now ?? (() => new Date());
  const scoped = costScopedConvergenceHost(input.host);
  input = { ...input, host: scoped.host };
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
  await resumeDependencies(input, now(), replay, baseline.sourceSnapshotHash);
  reconcileKnowledgeConvergenceOutbox(input.events, replay(), now().toISOString());
  for (let index = 0; index < (input.maximumStages ?? 8); index++) {
    if (index > 0 && (await input.shouldYield?.()) === true) break;
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
    // ADR-0600: a requeued stage counts the attempts its queued record carried forward.
    const attempts = delivery.attemptCount + carriedAttempts(delivery.event);
    scoped.enterStage(stage);
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
      const prepared = (await input.host.prepareStage?.(stage, state)) ?? null;
      assertLease();
      if (prepared !== null) result = prepared;
      else {
        await input.host.assertCurrent(state);
        assertLease();
        if (attempts > MAXIMUM_CONVERGENCE_STAGE_ATTEMPTS)
          throw Object.assign(new Error("Retry ceiling reached."), {
            code: "knowledge_retry_exhausted",
          });
        result = await input.host.runStage(stage, state, assertLease);
        assertLease();
      }
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
        canonicalJson(
          convergenceStageFailureRecord({
            code,
            error,
            evaluationContract: input.host.evaluationContract,
            state,
            stage,
            now: now(),
          }),
        ),
      );
      const exhausted = attempts >= MAXIMUM_CONVERGENCE_STAGE_ATTEMPTS;
      result = {
        state:
          code === "source_bytes_changed" && !exhausted
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
                    "provider_not_admitted",
                    "knowledge_capacity_unavailable",
                    "assignment_path_conflict",
                  ].includes(code)
                ? "waiting_authority"
                : "attention_required",
        input: state,
        assignmentId: null,
        leaseGeneration: null,
        failureCode: exhausted ? "knowledge_retry_exhausted" : code,
        dependencyHash: dependency.contentHash,
        nextStage: null,
      };
    }
    const stored = await input.artifacts.put(canonicalJson(result.input));
    assertLease();
    // The settlement transaction asserts this settlement after taking its lock, right before the
    // append; an earlier observation here would guard no effect of its own.
    settleKnowledgeConvergenceStage({
      events: input.events,
      delivery,
      row,
      workerId: input.workerId,
      stage,
      result,
      resultArtifactHash: stored.contentHash,
      now: now(),
      attempts,
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

function carriedAttempts(event: { type: string; payload: unknown }): number {
  if (event.type !== "repository.knowledge.stage.recorded") return 0;
  const count = (event.payload as { attemptCount?: unknown }).attemptCount;
  return Number.isSafeInteger(count) && (count as number) > 0 ? (count as number) : 0;
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
