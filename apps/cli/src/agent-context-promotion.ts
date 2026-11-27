// Promoting one entry into an agent's context (ADR-0554, ADR-0648): the one path that checks a
// promotion against the projection's rules and appends it, for `lervo agent context promote` and
// for the room's conversation notes. A promotion it refuses is never appended, so the projection,
// which refuses an agent's whole context over one bad entry, never meets it.
import { createHash } from "node:crypto";

import {
  agentContextReviewAttests,
  conversationNoteAttested,
  organizationIdentityHash,
  projectAgentContext,
  projectAgentContextFromEventSource,
  readAgentContextEventSource,
} from "@lervo/agent-organization";
import { listAgents, type WorkforceAgent } from "@lervo/agent-workforce";
import { coordinationEventSchemaVersion } from "@lervo/event-contract";
import type { ProjectStorage } from "@lervo/project-storage";
import type {
  AgentContextHandoffRecordedEventPayload,
  AgentContextPromotedEventPayload,
} from "@lervo/schemas";

import { mutateAgentOrganization } from "./agent-organization-mutation.js";

export interface AgentContextPromotion {
  readonly agentId: string;
  readonly layer: AgentContextPromotedEventPayload["layer"];
  readonly memoryKind: NonNullable<AgentContextPromotedEventPayload["memoryKind"]>;
  readonly subjectKey: string;
  readonly retrievalTerms: readonly string[];
  readonly confidence: "medium" | "high";
  readonly sensitivity: "internal" | "restricted";
  readonly source: {
    readonly kind: "event" | "artifact";
    readonly sourceId: string;
    readonly contentHash: string;
  };
  readonly reviewEventId: string;
  readonly summary: string;
  readonly observedAt?: string;
  readonly expiresAt?: string | null;
  readonly supersedes?: string;
  readonly now?: Date;
}

export function artifactId(contentHash: string): string {
  return `art_${contentHash.slice("sha256:".length)}`;
}

export function contextCoordinate(prefix: "actx" | "ach", value: unknown): string {
  const start = "sha256:".length;
  return `${prefix}_${organizationIdentityHash(value).slice(start, start + 24)}`;
}

export function activeAgent(agents: readonly WorkforceAgent[], agentId: string): WorkforceAgent {
  const agent = agents.find((candidate) => candidate.agentId === agentId);
  if (agent === undefined || agent.status !== "active") {
    throw new Error("Agent context mutation requires an active hired agent.");
  }
  return agent;
}

export function contextProjection(
  storage: ProjectStorage,
  agents: readonly WorkforceAgent[],
  agentId: string,
) {
  return projectAgentContextFromEventSource({
    projectId: storage.manifest.projectId,
    agentId,
    agents,
    events: storage.events,
  });
}

/**
 * Appends a context event. A conversation note needs event schema 16, which first admits its
 * kind; every other entry keeps the envelope version it always had.
 */
export function appendContextEvent(
  storage: ProjectStorage,
  type: "agent.context.promoted" | "agent.context.handoff.recorded",
  payload: AgentContextPromotedEventPayload | AgentContextHandoffRecordedEventPayload,
  occurredAt: string,
): void {
  const identity = organizationIdentityHash({ type, payload }).slice("sha256:".length, 40);
  const draft = {
    eventId: `evt_${identity}`,
    projectId: storage.manifest.projectId,
    runId: `run_${identity}`,
    sessionId: `ses_${identity}`,
    type,
    occurredAt,
    actor: { kind: "system" as const },
    policyVersion: organizationIdentityHash({ contract: "agent-context", version: 1 }),
    payload,
  };
  const writable = storage.writableEventSchemaVersion ?? 1;
  const note = "memoryKind" in payload && payload.memoryKind === "conversation_note";
  if (note && writable < coordinationEventSchemaVersion)
    throw new Error("A conversation note needs event schema 16.");
  storage.events.append(
    note
      ? { ...draft, schemaVersion: coordinationEventSchemaVersion }
      : writable >= 2
        ? { ...draft, schemaVersion: 2 }
        : { ...draft, schemaVersion: 1 },
  );
}

function retrievalDigests(terms: readonly string[]): string[] {
  return [
    ...new Set(
      terms.map(
        (term) =>
          `sha256:${createHash("sha256")
            .update(term.normalize("NFKC").toLocaleLowerCase("en-US"))
            .digest("hex")}`,
      ),
    ),
  ].sort();
}

/** Checks that the promotion's source exists with its exact hash. */
async function checkSource(storage: ProjectStorage, input: AgentContextPromotion): Promise<void> {
  const { kind, sourceId, contentHash } = input.source;
  if (kind === "event") {
    const source = storage.events.get(sourceId);
    if (source === null || source.eventHash !== contentHash)
      throw new Error("The context source event and hash do not match.");
    return;
  }
  if (sourceId !== artifactId(contentHash))
    throw new Error("The context source artifact ID and hash do not match.");
  if (!(await storage.artifacts.has(`lervo-cas://sha256/${contentHash.slice(7)}`)))
    throw new Error("The context source artifact does not exist.");
}

/** Checks the times and the subject's one active entry, as the projection will. */
function checkPlacement(
  input: AgentContextPromotion,
  entries: ReturnType<typeof contextProjection>["entries"],
  observedAt: string,
  expiresAt: string | null,
  promotedAt: string,
): void {
  if (
    !Number.isFinite(Date.parse(observedAt)) ||
    Date.parse(observedAt) > Date.parse(promotedAt) ||
    (expiresAt !== null &&
      (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.parse(observedAt)))
  )
    throw new Error("The context observation, expiry, and promotion times are inconsistent.");
  const superseded =
    input.supersedes === undefined
      ? undefined
      : entries.find(
          (entry) => entry.contextEntryId === input.supersedes && entry.status === "active",
        );
  if (
    (input.supersedes !== undefined &&
      (superseded === undefined || superseded.layer !== input.layer)) ||
    entries.some(
      (entry) =>
        entry.status === "active" &&
        entry.layer === input.layer &&
        entry.subjectKey === input.subjectKey &&
        entry.contextEntryId !== input.supersedes,
    )
  )
    throw new Error("The context subject requires one exact same-layer supersession.");
  if (
    input.memoryKind === "conversation_note" &&
    entries.some(
      (entry) =>
        entry.memoryKind === "conversation_note" && entry.reviewEventId === input.reviewEventId,
    )
  )
    throw new Error("A delivery's receipt attests one conversation note.");
}

/**
 * Promotes one entry into the agent's context, refusing what the projection would refuse: a
 * missing or mismatched source, a review that does not attest the entry, inconsistent times, an
 * unsuperseded subject, or a second note on one receipt. Returns the agent's context after it.
 */
export async function promoteAgentContext(root: string, input: AgentContextPromotion) {
  if (input.summary.trim().length === 0 || Buffer.byteLength(input.summary) > 32_768)
    throw new Error("The agent context summary is empty or exceeds 32 KiB.");
  return mutateAgentOrganization(root, async (storage) => {
    const agents = await listAgents(root);
    activeAgent(agents, input.agentId);
    const current = contextProjection(storage, agents, input.agentId);
    await checkSource(storage, input);
    const review = storage.events.get(input.reviewEventId);
    if (review === null) throw new Error("The context review event does not exist.");
    const promotedAt = (input.now ?? new Date()).toISOString();
    const observedAt = input.observedAt ?? promotedAt;
    const expiresAt = input.expiresAt ?? null;
    checkPlacement(input, current.entries, observedAt, expiresAt, promotedAt);
    const artifact = await storage.artifacts.put(input.summary);
    const content = {
      agentId: input.agentId,
      layer: input.layer,
      memoryKind: input.memoryKind,
      subjectKey: input.subjectKey,
      audience: "agent" as const,
      sensitivity: input.sensitivity,
      confidence: input.confidence,
      retrievalDigests: retrievalDigests(input.retrievalTerms),
      observedAt,
      expiresAt,
      reviewBindingVersion: 2 as const,
      source: { ...input.source },
      summaryArtifactId: artifactId(artifact.contentHash),
      summaryContentHash: artifact.contentHash,
      summaryByteCount: artifact.byteCount,
      reviewEventId: input.reviewEventId,
      reviewEventHash: review.eventHash,
      supersedesContextEntryId: input.supersedes ?? null,
      promotedAt,
    };
    const payload: AgentContextPromotedEventPayload = {
      contextEntryId: contextCoordinate("actx", content),
      ...content,
    };
    // The promotion as it would be recorded next, so the projection's own rules judge it.
    const source = readAgentContextEventSource(storage.events);
    const pending = {
      projectId: storage.manifest.projectId,
      seq: source.throughSeq + 1,
      type: "agent.context.promoted",
      payload,
    };
    const attested =
      input.memoryKind === "conversation_note"
        ? conversationNoteAttested(payload, pending, review, source.lookupEvent)
        : agentContextReviewAttests({
            review,
            summaryContentHash: artifact.contentHash,
            agentId: input.agentId,
          });
    if (!attested)
      throw new Error("The review does not attest the exact context summary and agent.");
    // ADR-0648: append only what the agent's projection accepts, with nothing awaited between the
    // check and the append, under the organization's mutation lock. A refused entry would
    // otherwise fail the agent's whole context.
    projectAgentContext({
      projectId: storage.manifest.projectId,
      agentId: input.agentId,
      agents,
      events: [...source.events, pending],
      lookupEvent: source.lookupEvent,
    });
    appendContextEvent(storage, "agent.context.promoted", payload, promotedAt);
    return contextProjection(storage, agents, input.agentId);
  });
}
