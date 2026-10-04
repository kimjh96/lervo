import type { ArtifactStore, OutboxDelivery, OutboxStore } from "@lervo/storage-contract";

import {
  loadKnowledgeIntakePolicy,
  type KnowledgeIntakePolicy,
} from "./knowledge-intake-policy.js";
import {
  readManifest,
  captureReviewSources,
  partitionReviewSubJobs,
  reviewFenceEntries,
  assertReviewSourcesCurrent,
  type RepositoryKnowledgeSourceManifest,
} from "./repository-knowledge-review-source.js";
import {
  RepositoryKnowledgeReviewError,
  TerminalOutcome,
  type RepositoryKnowledgeIntakeSummary,
  type RepositoryKnowledgeJobOutcome,
  type RepositoryKnowledgeWorkerHost,
} from "./repository-knowledge-worker-contract.js";
export { RepositoryKnowledgeReviewError } from "./repository-knowledge-worker-contract.js";
export type {
  RepositoryKnowledgeReviewSource,
  RepositoryKnowledgeReviewDecision,
  RepositoryKnowledgeReviewFailureCode,
  RepositoryKnowledgeReviewJob,
  RepositoryKnowledgeWorkerHost,
  RepositoryKnowledgeTerminalState,
  RepositoryKnowledgeJobOutcome,
} from "./repository-knowledge-worker-contract.js";
export {
  REPOSITORY_KNOWLEDGE_REQUEUE_DESTINATION,
  requeueStalledRepositoryKnowledgeJobs,
} from "./repository-knowledge-requeue.js";
export { repositoryKnowledgeResolutionEventId } from "./repository-knowledge-settlement.js";

import { assessCanonicalization } from "./canonicalization-candidate.js";
import { assertRepositoryKnowledgeJobLease } from "./repository-knowledge-job-lease.js";
import { REPOSITORY_KNOWLEDGE_REQUEUE_DESTINATION } from "./repository-knowledge-requeue.js";
import {
  MAXIMUM_REPOSITORY_KNOWLEDGE_ATTEMPTS,
  repositoryKnowledgeResolutionEventId,
  settleRepositoryKnowledgeJob,
} from "./repository-knowledge-settlement.js";

import { REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION } from "./repository-change-source.js";

const DEFAULT_LEASE_MS = 30 * 60_000;
/** New jobs first; re-queued history drains behind them. */
const DESTINATIONS = [
  REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION,
  REPOSITORY_KNOWLEDGE_REQUEUE_DESTINATION,
];

/**
 * Registers the canonicalization candidate whose review assigns the canonical write. Bindings stay
 * exact to the reviewed bytes, so a later source change turns the candidate stale.
 */
async function pendingReview(
  root: string,
  delivery: OutboxDelivery,
  reviewed: RepositoryKnowledgeSourceManifest["paths"],
  fence: () => void,
): Promise<TerminalOutcome> {
  const payload = delivery.event.payload as {
    repositoryRevisionBefore: string;
    repositoryRevisionAfter: string;
  };
  const files = (side: "before" | "after") =>
    Object.fromEntries(
      reviewed.flatMap((entry) => (entry[side] === null ? [] : [[entry.path, entry[side]]])),
    );
  try {
    const assessment = await assessCanonicalization({
      repositoryRoot: root,
      beforeRevision: payload.repositoryRevisionBefore,
      afterRevision: payload.repositoryRevisionAfter,
      beforeFiles: files("before"),
      afterFiles: files("after"),
      disposition: "canonical_sources_current",
      now: new Date(delivery.event.occurredAt),
    });
    fence();
    if (assessment.candidate === null)
      return new TerminalOutcome(
        "attention_required",
        "canonicalization_candidate_unavailable",
        "canonical_change_candidate",
      );
    return new TerminalOutcome(
      "pending_review",
      null,
      "canonical_change_candidate",
      null,
      assessment.candidate.candidateId,
    );
  } catch (error) {
    if ((error as { code?: unknown }).code === "knowledge_source_limit_exceeded")
      return new TerminalOutcome(
        "attention_required",
        "canonicalization_candidate_limit_exceeded",
        "canonical_change_candidate",
      );
    throw error;
  }
}

function emptyIntakeSummary(): RepositoryKnowledgeIntakeSummary {
  return { skippedPathCount: 0, skippedReasons: [], subJobIndex: null, subJobCount: 0 };
}

/**
 * Reviews every reviewable path in ordered sub-jobs that share one completion. The first sub-job
 * that is not implementation-only decides the outcome; `current` needs every sub-job reviewed.
 */
async function resolveJob(
  root: string,
  delivery: OutboxDelivery,
  artifacts: ArtifactStore,
  host: RepositoryKnowledgeWorkerHost,
  intakePolicy: KnowledgeIntakePolicy,
  summary: RepositoryKnowledgeIntakeSummary,
  assertLease: () => void,
): Promise<TerminalOutcome> {
  if (delivery.event.type !== "repository.change.completed")
    return new TerminalOutcome("attention_required", "knowledge_job_source_invalid");
  try {
    const manifest = await readManifest(artifacts, delivery);
    assertLease();
    const fenced = reviewFenceEntries(manifest, intakePolicy);
    const fence = () => assertReviewSourcesCurrent(root, fenced);
    const capture = await captureReviewSources(root, manifest, intakePolicy);
    summary.skippedPathCount = capture.skipped.length;
    summary.skippedReasons = [
      ...new Set(capture.skipped.map((item) => item.fileDisposition)),
    ].sort();
    const subJobs = partitionReviewSubJobs(capture.sources);
    summary.subJobCount = subJobs.length;
    assertLease();
    // Generated paths carry no knowledge; an oversize or binary path alone cannot be reviewed.
    if (
      subJobs.length === 0 &&
      capture.skipped.some((item) => item.fileDisposition !== "skipped_generated")
    )
      return new TerminalOutcome("attention_required", "review_sources_unreviewable");
    for (const [index, sources] of subJobs.entries()) {
      summary.subJobIndex = index;
      const decision = await host.review(sources, {
        changeEventId: delivery.event.eventId,
        destinationId: delivery.destinationId,
        attemptCount: delivery.attemptCount,
        subJobIndex: index,
        subJobCount: subJobs.length,
        resolutionEventId: repositoryKnowledgeResolutionEventId(
          delivery.event.eventId,
          delivery.destinationId,
        ),
      });
      summary.subJobIndex = null;
      assertLease();
      host.assertReviewContextCurrent?.();
      fence();
      if (decision.classification === "implementation_only") continue;
      summary.subJobIndex = index;
      if (decision.classification === "canonical_change_candidate") {
        const reviewed = new Set(capture.sources.map(({ source }) => source.path));
        return await pendingReview(
          root,
          delivery,
          manifest.paths.filter((entry) => reviewed.has(entry.path)),
          fence,
        );
      }
      return new TerminalOutcome("attention_required", "review_needs_attention", "needs_review");
    }
    // Unreconstructable former bytes cannot support a knowledge-currency claim.
    if (capture.sources.some(({ source }) => source.before.kind === "unavailable"))
      return new TerminalOutcome(
        "attention_required",
        "before_bytes_unavailable",
        "implementation_only",
      );
    const knowledge = await host.inspectKnowledge();
    assertLease();
    host.assertReviewContextCurrent?.();
    fence();
    if (!knowledge.current)
      return new TerminalOutcome(
        "attention_required",
        "knowledge_lifecycle_pending",
        "implementation_only",
      );
    return new TerminalOutcome("current", null, "implementation_only", knowledge.snapshotHash);
  } catch (error) {
    if (error instanceof TerminalOutcome) return error;
    if (error instanceof RepositoryKnowledgeReviewError)
      return new TerminalOutcome("attention_required", error.code);
    const code = (error as { code?: unknown })?.code;
    if (
      typeof code === "string" &&
      [
        "review_context_stale",
        "review_context_unavailable",
        "review_context_limit_exceeded",
      ].includes(code)
    )
      return new TerminalOutcome(
        code === "review_context_stale" ? "stale" : "attention_required",
        code,
      );
    throw error;
  }
}

/** Rechecks a successful outcome immediately before its settlement transaction. */
async function recheckSuccess(
  root: string,
  delivery: OutboxDelivery,
  artifacts: ArtifactStore,
  host: RepositoryKnowledgeWorkerHost,
  intakePolicy: KnowledgeIntakePolicy,
  outcome: TerminalOutcome,
): Promise<TerminalOutcome> {
  if (outcome.terminalState !== "current" && outcome.terminalState !== "pending_review")
    return outcome;
  try {
    const manifest = await readManifest(artifacts, delivery);
    assertReviewSourcesCurrent(root, reviewFenceEntries(manifest, intakePolicy));
    host.assertReviewContextCurrent?.();
    return outcome;
  } catch (error) {
    if (error instanceof TerminalOutcome) return error;
    const code = (error as { code?: unknown })?.code;
    if (typeof code !== "string" || !code.startsWith("review_context_")) throw error;
    return new TerminalOutcome(
      code === "review_context_stale" ? "stale" : "attention_required",
      code,
    );
  }
}

function claimNext(
  events: OutboxStore,
  workerId: string,
  claimedAt: string,
  leaseDurationMs: number,
): OutboxDelivery | undefined {
  return events.transact((transaction) => {
    for (const destinationId of DESTINATIONS) {
      const [delivery] = transaction.claim({
        workerId,
        claimedAt,
        leaseDurationMs,
        destinationId,
        limit: 1,
      });
      if (delivery !== undefined) return delivery;
    }
    return undefined;
  });
}

/**
 * Settles up to `maximumJobs` queued repository knowledge jobs, new jobs before re-queued ones. A
 * transient host failure is rescheduled with backoff, and the sixteenth attempt settles as
 * retry-exhausted attention.
 */
export async function processRepositoryKnowledgeJobs(input: {
  repositoryRoot: string;
  events: OutboxStore;
  artifacts: ArtifactStore;
  workerId: string;
  host: RepositoryKnowledgeWorkerHost;
  now?: () => Date;
  maximumJobs?: number;
  leaseDurationMs?: number;
}): Promise<RepositoryKnowledgeJobOutcome[]> {
  const now = input.now ?? (() => new Date());
  const outcomes: RepositoryKnowledgeJobOutcome[] = [];
  const intakePolicy = await loadKnowledgeIntakePolicy(input.repositoryRoot);
  for (let index = 0; index < (input.maximumJobs ?? 8); index++) {
    const delivery = claimNext(
      input.events,
      input.workerId,
      now().toISOString(),
      input.leaseDurationMs ?? DEFAULT_LEASE_MS,
    );
    if (delivery === undefined) break;
    let outcome: TerminalOutcome;
    const summary = emptyIntakeSummary();
    const assertLease = () =>
      assertRepositoryKnowledgeJobLease({ events: input.events, delivery, now: now() });
    try {
      assertLease();
      outcome =
        delivery.attemptCount > MAXIMUM_REPOSITORY_KNOWLEDGE_ATTEMPTS
          ? new TerminalOutcome("attention_required", "knowledge_retry_exhausted")
          : await resolveJob(
              input.repositoryRoot,
              delivery,
              input.artifacts,
              input.host,
              intakePolicy,
              summary,
              assertLease,
            );
    } catch {
      if (delivery.attemptCount < MAXIMUM_REPOSITORY_KNOWLEDGE_ATTEMPTS) {
        const failedAt = now();
        const delayMs = Math.min(60 * 60_000, 60_000 * 2 ** (delivery.attemptCount - 1));
        input.events.transact((transaction) =>
          transaction.reschedule({
            eventId: delivery.event.eventId,
            destinationId: delivery.destinationId,
            workerId: input.workerId,
            failedAt: failedAt.toISOString(),
            availableAt: new Date(failedAt.getTime() + delayMs).toISOString(),
            failureCode: "knowledge_job_transient_failure",
          }),
        );
        outcomes.push({
          changeEventId: delivery.event.eventId,
          terminalState: "retry_scheduled",
          failureCode: "knowledge_job_transient_failure",
        });
        continue;
      }
      outcome = new TerminalOutcome("attention_required", "knowledge_retry_exhausted");
    }
    outcome = await recheckSuccess(
      input.repositoryRoot,
      delivery,
      input.artifacts,
      input.host,
      intakePolicy,
      outcome,
    );
    settleRepositoryKnowledgeJob({
      events: input.events,
      delivery,
      workerId: input.workerId,
      outcome,
      intake: summary,
      resolvedAt: now().toISOString(),
    });
    outcomes.push({
      changeEventId: delivery.event.eventId,
      terminalState: outcome.terminalState,
      failureCode: outcome.failureCode,
    });
  }
  return outcomes;
}
