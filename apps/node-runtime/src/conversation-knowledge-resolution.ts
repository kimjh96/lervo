import { createHash } from "node:crypto";

import { assertReadOnlyKnowledgeReviewAuthority } from "@lervo/agent-workforce";
import type { EventDraftV3 } from "@lervo/event-contract";
import type { EventEnvelope } from "@lervo/schemas";
import type { ArtifactStore, OutboxDelivery, OutboxStore } from "@lervo/storage-contract";
import { collectRunEventsBounded } from "@lervo/storage-contract";

import { conversationKnowledgeAssignmentProvenance } from "./conversation-knowledge-assignment-provenance.js";
import { readConversationKnowledgeJobSource } from "./conversation-knowledge-job-source.js";
import { readLeasedConversationKnowledgeJob } from "./conversation-knowledge-lease.js";
import {
  CONVERSATION_KNOWLEDGE_OUTBOX_DESTINATION,
  conversationKnowledgeJobId,
} from "./conversation-knowledge-outbox-reconciliation.js";
import { inspectRepositoryWorkSourceCurrency } from "./repository-work-source-currency.js";

const FAILURE_CODE = /^[a-z][a-z0-9_]{0,63}$/u;
const MAXIMUM_ATTEMPTS = 16;
const SOURCE_CURRENCY_FAILURES = new Set([
  "source_bytes_changed",
  "before_bytes_unavailable",
  "unsafe_path_resolution",
  "source_evidence_unavailable",
]);

export class ConversationKnowledgeResolutionError extends Error {
  constructor(readonly code: "knowledge_resolution_invalid" | "knowledge_resolution_conflict") {
    super(`Conversation knowledge resolution failed: ${code}.`);
    this.name = "ConversationKnowledgeResolutionError";
  }
}

function resolutionEventId(completionEventId: string): string {
  return `evt_kres_${createHash("sha256")
    .update(`lervo.conversation.knowledge-resolution.v1\0${completionEventId}`)
    .digest("hex")
    .slice(0, 24)}`;
}

function matchingResolution(
  event: EventEnvelope,
  input: {
    completion: EventEnvelope;
    agentId: string;
    provider: "codex" | "claude";
    terminalState: "stale" | "attention_required";
    failureCode: string;
  },
): boolean {
  if (event.type !== "conversation.repository_knowledge.resolved") return false;
  const payload = event.payload;
  const sourceManifest = payload.sourceManifest;
  if (sourceManifest === null || typeof sourceManifest !== "object") return false;
  const manifest = sourceManifest as Record<string, unknown>;
  return (
    event.eventId === resolutionEventId(input.completion.eventId) &&
    event.runId === input.completion.runId &&
    event.sessionId === input.completion.sessionId &&
    event.policyVersion === input.completion.policyVersion &&
    event.actor.kind === "agent" &&
    event.actor.provider === input.provider &&
    payload.completionEventId === input.completion.eventId &&
    payload.completionEventHash === input.completion.eventHash &&
    payload.sourceConversationEventId === input.completion.payload.sourceConversationEventId &&
    payload.jobId === conversationKnowledgeJobId(input.completion.eventId) &&
    payload.agentId === input.agentId &&
    manifest.kind === "content_bound" &&
    manifest.contentHash === input.completion.payload.sourceManifestContentHash &&
    manifest.byteCount === input.completion.payload.sourceManifestByteCount &&
    payload.terminalState === input.terminalState &&
    payload.failureCode === input.failureCode &&
    payload.knowledgeSnapshotHash === null &&
    payload.resolvedAt === event.occurredAt
  );
}

/** Commits one non-success outcome and queue acknowledgement in the same exact-lease transaction. */
export async function resolveLeasedConversationKnowledgeFailure(input: {
  events: OutboxStore;
  artifacts: ArtifactStore;
  repositoryRoot: string;
  claimed: OutboxDelivery;
  workerId: string;
  now(): string;
  assignmentId: string;
  agentId: string;
  assignmentLeaseId: string;
  provider: "codex" | "claude";
  verificationSuiteIds: string[];
  terminalState: "stale" | "attention_required";
  failureCode: string;
}): Promise<{ event: EventEnvelope; inserted: boolean }> {
  if (!FAILURE_CODE.test(input.failureCode))
    throw new ConversationKnowledgeResolutionError("knowledge_resolution_invalid");
  const first = readLeasedConversationKnowledgeJob({ ...input, now: input.now() });
  const provenance = conversationKnowledgeAssignmentProvenance({
    job: first,
    agentId: input.agentId,
  });
  const manifest = await readConversationKnowledgeJobSource({
    completion: first.completion,
    artifacts: input.artifacts,
  });
  const sourcePaths = manifest.paths.map((item) => item.path);
  const currency = await inspectRepositoryWorkSourceCurrency({
    repositoryRoot: input.repositoryRoot,
    manifest,
  });
  if (
    (input.terminalState === "stale" &&
      (currency.status !== "stale" || currency.reasonCode !== input.failureCode)) ||
    (input.terminalState === "attention_required" && currency.status === "stale") ||
    (currency.status === "needs_review" && currency.reasonCode !== input.failureCode) ||
    (currency.status === "ready_for_review" && SOURCE_CURRENCY_FAILURES.has(input.failureCode))
  )
    throw new ConversationKnowledgeResolutionError("knowledge_resolution_invalid");
  await assertReadOnlyKnowledgeReviewAuthority({
    repositoryRoot: input.repositoryRoot,
    assignmentId: input.assignmentId,
    agentId: input.agentId,
    leaseId: input.assignmentLeaseId,
    provider: input.provider,
    sourcePaths,
    verificationSuiteIds: input.verificationSuiteIds,
    knowledgeJob: provenance,
    now: new Date(input.now()),
  });

  return input.events.transact((transaction) => {
    const resolvedAt = input.now();
    const job = readLeasedConversationKnowledgeJob({ ...input, now: resolvedAt });
    if (
      job.completion.eventHash !== first.completion.eventHash ||
      job.attemptCount !== first.attemptCount
    )
      throw new ConversationKnowledgeResolutionError("knowledge_resolution_conflict");
    const retryExhausted = input.failureCode === "knowledge_retry_exhausted";
    if (
      (retryExhausted &&
        (input.terminalState !== "attention_required" || job.attemptCount < MAXIMUM_ATTEMPTS)) ||
      (job.attemptCount > MAXIMUM_ATTEMPTS &&
        input.terminalState === "attention_required" &&
        !retryExhausted)
    )
      throw new ConversationKnowledgeResolutionError("knowledge_resolution_invalid");
    const prior = collectRunEventsBounded({
      events: input.events,
      runId: job.completion.runId,
      maximumEvents: 1_000,
    }).filter((event) => event.type === "conversation.repository_knowledge.resolved");
    if (
      prior.length > 1 ||
      (prior.length === 1 &&
        !matchingResolution(prior[0]!, {
          completion: job.completion,
          agentId: input.agentId,
          provider: input.provider,
          terminalState: input.terminalState,
          failureCode: input.failureCode,
        }))
    )
      throw new ConversationKnowledgeResolutionError("knowledge_resolution_conflict");
    let event = prior[0];
    let inserted = false;
    if (event === undefined) {
      const completion = job.completion;
      const draft = {
        eventId: resolutionEventId(completion.eventId),
        projectId: completion.projectId,
        runId: completion.runId,
        sessionId: completion.sessionId,
        type: "conversation.repository_knowledge.resolved",
        occurredAt: resolvedAt,
        actor: { kind: "agent", provider: input.provider },
        schemaVersion: 3,
        policyVersion: completion.policyVersion,
        payload: {
          completionEventId: completion.eventId,
          completionEventHash: completion.eventHash,
          sourceConversationEventId: provenance.sourceConversationEventId,
          jobId: job.jobId,
          agentId: input.agentId,
          sourceManifest: {
            kind: "content_bound",
            contentHash: provenance.sourceManifestHash,
            byteCount: completion.payload.sourceManifestByteCount,
          },
          terminalState: input.terminalState,
          // A recovery lease after the retry ceiling is not another work attempt.
          attemptCount: Math.min(job.attemptCount, MAXIMUM_ATTEMPTS),
          failureCode: input.failureCode,
          knowledgeSnapshotHash: null,
          resolvedAt,
        },
      } satisfies EventDraftV3;
      const appended = transaction.append(draft);
      event = appended.event;
      inserted = appended.inserted;
    }
    transaction.acknowledge({
      eventId: input.claimed.event.eventId,
      destinationId: CONVERSATION_KNOWLEDGE_OUTBOX_DESTINATION,
      workerId: input.workerId,
      acknowledgedAt: resolvedAt,
    });
    return { event, inserted };
  });
}
