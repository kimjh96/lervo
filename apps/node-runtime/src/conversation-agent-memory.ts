import { createHash } from "node:crypto";

import { agentContextReviewAttests, organizationIdentityHash } from "@lervo/agent-organization";
import type { EventDraftV2 } from "@lervo/event-contract";
import type { AgentContextPromotedEventPayload, EventEnvelope } from "@lervo/schemas";
import type { ArtifactStore, EventStore } from "@lervo/storage-contract";

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function retrievalDigests(summary: string, changedPaths: readonly string[]): string[] {
  const terms = new Set<string>();
  for (const path of changedPaths) terms.add(path.normalize("NFKC").toLocaleLowerCase("en-US"));
  for (const token of summary
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .match(/[\p{L}\p{N}._/-]+/gu) ?? []) {
    if ([...token].length >= 3) terms.add(token);
    if (terms.size >= 24) break;
  }
  if (terms.size === 0) terms.add("completed-work");
  return [...terms].slice(0, 24).map(sha256).sort();
}

export async function prepareConversationWorkMemory(input: {
  artifacts: ArtifactStore;
  summary: string;
  changedPaths: readonly string[];
}) {
  const summaryArtifact = await input.artifacts.put(input.summary);
  return {
    summaryArtifact,
    retrievalDigests: retrievalDigests(input.summary, input.changedPaths),
  };
}

/** Creates one completion-attested, medium-confidence work-outcome memory event. */
export function createVerifiedConversationWorkMemoryDraft(input: {
  projectId: string;
  completion: EventEnvelope;
  workerAgentId: string;
  prepared: Awaited<ReturnType<typeof prepareConversationWorkMemory>>;
}): EventDraftV2 {
  const { summaryArtifact } = input.prepared;
  if (
    !agentContextReviewAttests({
      review: input.completion,
      summaryContentHash: summaryArtifact.contentHash,
      agentId: input.workerAgentId,
    })
  ) {
    throw new Error("The repository-work completion does not attest its agent memory summary.");
  }
  const subjectKey = `conversation-work:${input.completion.eventId}`;
  const content = {
    agentId: input.workerAgentId,
    layer: "work" as const,
    memoryKind: "work_outcome" as const,
    subjectKey,
    audience: "agent" as const,
    sensitivity: "internal" as const,
    confidence: "medium" as const,
    retrievalDigests: input.prepared.retrievalDigests,
    observedAt: input.completion.occurredAt,
    expiresAt: new Date(Date.parse(input.completion.occurredAt) + 90 * 86_400_000).toISOString(),
    reviewBindingVersion: 2 as const,
    source: {
      kind: "event" as const,
      sourceId: input.completion.eventId,
      contentHash: input.completion.eventHash,
    },
    summaryArtifactId: `art_${summaryArtifact.contentHash.slice("sha256:".length)}`,
    summaryContentHash: summaryArtifact.contentHash,
    summaryByteCount: summaryArtifact.byteCount,
    reviewEventId: input.completion.eventId,
    reviewEventHash: input.completion.eventHash,
    supersedesContextEntryId: null,
    promotedAt: input.completion.occurredAt,
  };
  const payload: AgentContextPromotedEventPayload = {
    contextEntryId: `actx_${organizationIdentityHash(content).slice("sha256:".length, 31)}`,
    ...content,
  };
  const identity = organizationIdentityHash({ type: "agent.context.promoted", payload }).slice(
    "sha256:".length,
    39,
  );
  return {
    eventId: `evt_${identity}`,
    projectId: input.projectId,
    runId: `run_${identity}`,
    sessionId: `ses_${identity}`,
    type: "agent.context.promoted",
    occurredAt: input.completion.occurredAt,
    actor: { kind: "system" },
    schemaVersion: 2,
    policyVersion: sha256("lervo.agent-context.verified-work.v2"),
    payload,
  };
}

/** Convenience boundary for repair and tests; new completions append both events transactionally. */
export async function recordVerifiedConversationWorkMemory(input: {
  projectId: string;
  events: Pick<EventStore, "append">;
  artifacts: ArtifactStore;
  completion: EventEnvelope;
  summary: string;
  workerAgentId: string;
  changedPaths: readonly string[];
}): Promise<void> {
  const prepared = await prepareConversationWorkMemory(input);
  input.events.append(
    createVerifiedConversationWorkMemoryDraft({
      projectId: input.projectId,
      completion: input.completion,
      workerAgentId: input.workerAgentId,
      prepared,
    }),
  );
}
