import { createHash } from "node:crypto";

import type { ArtifactStore, OutboxDelivery, OutboxStore } from "@lervo/storage-contract";

import {
  readManifest,
  reviewSources,
  assertReviewSourcesCurrent,
} from "./repository-knowledge-review-source.js";
import {
  TerminalOutcome,
  type RepositoryKnowledgeJobOutcome,
  type RepositoryKnowledgeWorkerHost,
} from "./repository-knowledge-worker-contract.js";
export type {
  RepositoryKnowledgeReviewSource,
  RepositoryKnowledgeReviewDecision,
  RepositoryKnowledgeWorkerHost,
  RepositoryKnowledgeTerminalState,
  RepositoryKnowledgeJobOutcome,
} from "./repository-knowledge-worker-contract.js";

import { assessCanonicalization } from "./canonicalization-candidate.js";
import { assertRepositoryKnowledgeJobLease } from "./repository-knowledge-job-lease.js";

import {
  MAXIMUM_REPOSITORY_CHANGE_PUBLISHED_PATHS,
  REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION,
  type RepositoryChangeSourceKind,
} from "./repository-change-source.js";

const MAXIMUM_ATTEMPTS = 16;
const DEFAULT_LEASE_MS = 30 * 60_000;

function sha256(content: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

/**
 * Registers the canonicalization candidate whose review assigns the canonical write. Bindings stay
 * exact to the reviewed bytes, so a later source change turns the candidate stale.
 */
async function pendingReview(
  root: string,
  delivery: OutboxDelivery,
  manifest: { paths: { path: string; before: string | null; after: string | null }[] },
): Promise<TerminalOutcome> {
  const payload = delivery.event.payload as {
    repositoryRevisionBefore: string;
    repositoryRevisionAfter: string;
  };
  const files = (side: "before" | "after") =>
    Object.fromEntries(
      manifest.paths.flatMap((entry) => (entry[side] === null ? [] : [[entry.path, entry[side]]])),
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
    assertReviewSourcesCurrent(root, manifest);
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

async function resolveJob(
  root: string,
  delivery: OutboxDelivery,
  artifacts: ArtifactStore,
  host: RepositoryKnowledgeWorkerHost,
  assertLease: () => void,
): Promise<TerminalOutcome> {
  const payload = delivery.event.payload as {
    changedPathCount: number;
    sourceManifest: { contentHash: string; byteCount: number };
  };
  if (delivery.event.type !== "repository.change.completed")
    return new TerminalOutcome("attention_required", "knowledge_job_source_invalid");
  if (payload.changedPathCount > MAXIMUM_REPOSITORY_CHANGE_PUBLISHED_PATHS)
    return new TerminalOutcome("attention_required", "repository_change_path_limit_exceeded");
  try {
    const manifest = await readManifest(artifacts, delivery);
    assertLease();
    const sources = await reviewSources(root, manifest);
    assertLease();
    const decision = await host.review(sources);
    assertLease();
    host.assertReviewContextCurrent?.();
    assertReviewSourcesCurrent(root, manifest);
    if (sources.some((source) => source.before.kind === "opaque" || source.after.kind === "opaque"))
      return new TerminalOutcome(
        "attention_required",
        "asset_verification_required",
        decision.classification,
      );
    if (decision.classification === "canonical_change_candidate")
      return await pendingReview(root, delivery, manifest);
    if (decision.classification === "needs_review")
      return new TerminalOutcome("attention_required", "review_needs_attention", "needs_review");
    // Unreconstructable former bytes cannot support a knowledge-currency claim.
    if (sources.some((source) => source.before.kind === "unavailable"))
      return new TerminalOutcome(
        "attention_required",
        "before_bytes_unavailable",
        decision.classification,
      );
    const knowledge = await host.inspectKnowledge();
    assertLease();
    host.assertReviewContextCurrent?.();
    assertReviewSourcesCurrent(root, manifest);
    if (!knowledge.current)
      return new TerminalOutcome(
        "attention_required",
        "knowledge_lifecycle_pending",
        decision.classification,
      );
    return new TerminalOutcome("current", null, decision.classification, knowledge.snapshotHash);
  } catch (error) {
    if (error instanceof TerminalOutcome) return error;
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

function settle(
  events: OutboxStore,
  delivery: OutboxDelivery,
  workerId: string,
  outcome: TerminalOutcome,
  resolvedAt: string,
): void {
  const change = delivery.event;
  events.transact((transaction) => {
    assertRepositoryKnowledgeJobLease({ events, delivery, now: new Date(resolvedAt) });
    transaction.append({
      eventId: `evt_${sha256(`repository.knowledge.resolved\0${change.eventId}`).slice(7, 39)}`,
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
        attemptCount: Math.min(delivery.attemptCount, MAXIMUM_ATTEMPTS),
        failureCode: outcome.failureCode,
        knowledgeSnapshotHash: outcome.knowledgeSnapshotHash,
        canonicalizationCandidateId: outcome.canonicalizationCandidateId,
        resolvedAt,
      },
    });
    // The outcome and the acknowledgement share one commit; a lost lease rolls both back.
    if (
      !transaction.acknowledge({
        eventId: change.eventId,
        destinationId: REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION,
        workerId,
        acknowledgedAt: resolvedAt,
      }).acknowledged
    )
      throw new Error("The repository knowledge job lease was lost before settlement.");
  });
}

/**
 * Settles up to `maximumJobs` queued repository knowledge jobs. A transient host failure is
 * rescheduled with backoff, and the sixteenth attempt settles as retry-exhausted attention.
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
  for (let index = 0; index < (input.maximumJobs ?? 8); index++) {
    const [delivery] = input.events.transact((transaction) =>
      transaction.claim({
        workerId: input.workerId,
        claimedAt: now().toISOString(),
        leaseDurationMs: input.leaseDurationMs ?? DEFAULT_LEASE_MS,
        destinationId: REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION,
        limit: 1,
      }),
    );
    if (delivery === undefined) break;
    let outcome: TerminalOutcome;
    const assertLease = () =>
      assertRepositoryKnowledgeJobLease({ events: input.events, delivery, now: now() });
    try {
      assertLease();
      outcome =
        delivery.attemptCount > MAXIMUM_ATTEMPTS
          ? new TerminalOutcome("attention_required", "knowledge_retry_exhausted")
          : await resolveJob(
              input.repositoryRoot,
              delivery,
              input.artifacts,
              input.host,
              assertLease,
            );
    } catch {
      if (delivery.attemptCount < MAXIMUM_ATTEMPTS) {
        const failedAt = now();
        const delayMs = Math.min(60 * 60_000, 60_000 * 2 ** (delivery.attemptCount - 1));
        input.events.transact((transaction) =>
          transaction.reschedule({
            eventId: delivery.event.eventId,
            destinationId: REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION,
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
    if (outcome.terminalState === "current" || outcome.terminalState === "pending_review") {
      try {
        const manifest = await readManifest(input.artifacts, delivery);
        assertReviewSourcesCurrent(input.repositoryRoot, manifest);
        input.host.assertReviewContextCurrent?.();
      } catch (error) {
        if (error instanceof TerminalOutcome) outcome = error;
        else {
          const code = (error as { code?: unknown })?.code;
          if (typeof code !== "string" || !code.startsWith("review_context_")) throw error;
          outcome = new TerminalOutcome(
            code === "review_context_stale" ? "stale" : "attention_required",
            code,
          );
        }
      }
    }
    settle(input.events, delivery, input.workerId, outcome, now().toISOString());
    outcomes.push({
      changeEventId: delivery.event.eventId,
      terminalState: outcome.terminalState,
      failureCode: outcome.failureCode,
    });
  }
  return outcomes;
}
