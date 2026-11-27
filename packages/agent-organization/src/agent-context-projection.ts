import { agentContextEvent } from "./agent-context-event-validation.js";
import { conversationNoteAttested } from "./agent-context-note.js";
import {
  agentContextReviewAttests,
  hasCompleteGovernedAgentContextMetadata,
  hasGovernedAgentContextMetadata,
} from "./agent-context-review.js";
import {
  AgentContextError,
  type AgentContextEventEnvelope,
  type AgentContextProjection,
  type AgentContextWorkforceIdentity,
  type ProjectedAgentContextEntry,
} from "./agent-context-types.js";

type ContextEvent = NonNullable<ReturnType<typeof agentContextEvent>>;
type PromotionPayload = Extract<ContextEvent, { type: "agent.context.promoted" }>["payload"];
type HandoffPayload = Extract<ContextEvent, { type: "agent.context.handoff.recorded" }>["payload"];

function conflict(message: string): never {
  throw new AgentContextError("agent_context_state_conflict", message);
}

function artifactId(contentHash: string): string {
  return `art_${contentHash.slice("sha256:".length)}`;
}

const legacyReviewEventTypes = new Set([
  "knowledge.candidate.reviewed",
  "knowledge.reconciliation.reviewed",
  "knowledge.verified",
  "verification.completed",
]);

function legacyReviewQualifies(review: AgentContextEventEnvelope): boolean {
  const payload = review.payload as Record<string, unknown>;
  return (
    legacyReviewEventTypes.has(review.type) &&
    (review.type !== "verification.completed" || payload.status === "passed")
  );
}

function assertSourceAndReview(
  envelope: AgentContextEventEnvelope,
  eventById: (eventId: string) => AgentContextEventEnvelope | undefined,
): void {
  const payload = agentContextEvent(envelope)?.payload;
  if (payload === undefined || !("reviewEventId" in payload)) return;
  if (payload.summaryArtifactId !== artifactId(payload.summaryContentHash)) {
    conflict("The promoted context summary artifact coordinate is invalid.");
  }
  const review = eventById(payload.reviewEventId);
  const metadata = payload as Record<string, unknown>;
  const governed = hasCompleteGovernedAgentContextMetadata(metadata);
  // A conversation note is attested by its delivery's receipt, never by a review of its words.
  if (payload.memoryKind === "conversation_note") {
    if (
      !governed ||
      review === undefined ||
      review.eventHash !== payload.reviewEventHash ||
      !conversationNoteAttested(payload, envelope, review, eventById)
    )
      conflict("A conversation note requires its own delivery's receipt.");
    return;
  }
  if (
    (hasGovernedAgentContextMetadata(metadata) && !governed) ||
    review === undefined ||
    review.eventHash !== payload.reviewEventHash ||
    (governed
      ? !agentContextReviewAttests({
          review,
          summaryContentHash: payload.summaryContentHash,
          agentId: payload.agentId,
        })
      : !legacyReviewQualifies(review))
  ) {
    conflict("The context promotion review does not attest the exact summary and agent.");
  }
  if (payload.source.kind === "event") {
    const source = eventById(payload.source.sourceId);
    if (source === undefined || source.eventHash !== payload.source.contentHash) {
      conflict("The context promotion source event does not match its exact hash.");
    }
  } else if (payload.source.sourceId !== artifactId(payload.source.contentHash)) {
    conflict("The context promotion source artifact coordinate is invalid.");
  }
}

/** Applies one promotion to `entries`, refusing any that the context's rules forbid. */
function applyPromotion(
  entries: ProjectedAgentContextEntry[],
  envelope: AgentContextEventEnvelope,
  payload: PromotionPayload,
  eventById: (eventId: string) => AgentContextEventEnvelope | undefined,
): void {
  assertSourceAndReview(envelope, eventById);
  if (
    payload.reviewBindingVersion === 2 &&
    (Date.parse(payload.observedAt!) > Date.parse(payload.promotedAt) ||
      (payload.expiresAt !== null &&
        Date.parse(payload.expiresAt!) <= Date.parse(payload.observedAt!)))
  ) {
    conflict("The context observation, expiry, and promotion times are inconsistent.");
  }
  if (entries.some((entry) => entry.contextEntryId === payload.contextEntryId)) {
    conflict("An agent context entry ID cannot be reused.");
  }
  if (
    payload.memoryKind === "conversation_note" &&
    entries.some(
      (entry) =>
        entry.memoryKind === "conversation_note" && entry.reviewEventId === payload.reviewEventId,
    )
  ) {
    conflict("A delivery's receipt attests one conversation note.");
  }
  if (payload.supersedesContextEntryId !== null) {
    const prior = entries.find(
      (entry) => entry.contextEntryId === payload.supersedesContextEntryId,
    );
    if (
      prior === undefined ||
      prior.agentId !== payload.agentId ||
      prior.layer !== payload.layer ||
      prior.status !== "active"
    ) {
      conflict("A context promotion can supersede only one active entry in the same namespace.");
    }
    // Self-reported words never replace reviewed memory.
    if (payload.memoryKind === "conversation_note" && prior.memoryKind !== "conversation_note") {
      conflict("A conversation note can supersede only another conversation note.");
    }
    prior.status = "superseded";
  }
  const sameSubject = entries.find(
    (entry) =>
      entry.agentId === payload.agentId &&
      entry.layer === payload.layer &&
      payload.subjectKey !== undefined &&
      entry.subjectKey === payload.subjectKey &&
      entry.status === "active",
  );
  if (sameSubject !== undefined) {
    conflict("An active context subject must be explicitly superseded before replacement.");
  }
  entries.push({ ...structuredClone(payload), status: "active" });
}

/** Applies one handoff, refusing one that moves entries it may not. */
function applyHandoff(
  entries: readonly ProjectedAgentContextEntry[],
  handoffs: AgentContextProjection["incomingHandoffs"],
  agents: readonly AgentContextWorkforceIdentity[],
  payload: HandoffPayload,
): void {
  if (
    payload.fromAgentId === payload.toAgentId ||
    !agents.some((candidate) => candidate.agentId === payload.fromAgentId) ||
    !agents.some(
      (candidate) => candidate.agentId === payload.toAgentId && candidate.status === "active",
    ) ||
    handoffs.some((handoff) => handoff.contextHandoffId === payload.contextHandoffId) ||
    payload.manifestArtifactId !== artifactId(payload.manifestContentHash)
  ) {
    conflict("The context handoff identity, successor, or manifest is invalid.");
  }
  if (
    payload.contextEntryIds.some(
      (entryId) =>
        !entries.some(
          (entry) => entry.contextEntryId === entryId && entry.agentId === payload.fromAgentId,
        ),
    )
  ) {
    conflict("A context handoff can include only entries owned by its source agent.");
  }
  // A conversation note is its agent's own, self-reported: it never reaches another agent.
  if (
    payload.contextEntryIds.some((entryId) =>
      entries.some(
        (entry) => entry.contextEntryId === entryId && entry.memoryKind === "conversation_note",
      ),
    )
  ) {
    conflict("A conversation note stays with its own agent.");
  }
  handoffs.push(structuredClone(payload));
}

export function projectAgentContext(input: {
  projectId: string;
  agentId: string;
  agents: readonly AgentContextWorkforceIdentity[];
  events: readonly AgentContextEventEnvelope[];
  /**
   * Resolves review and source events that a typed read did not return (ADR-0554). The caller
   * answers only from the same verified store snapshot; absent, the given events must hold them.
   */
  lookupEvent?: (eventId: string) => AgentContextEventEnvelope | undefined;
  /**
   * The head a typed read observed. It is reported as `lastSequence`, as when the whole history
   * through that head was given; absent, the last given event is reported.
   */
  observedThroughSeq?: number;
}): AgentContextProjection {
  const agent = input.agents.find((candidate) => candidate.agentId === input.agentId);
  if (agent === undefined) {
    throw new AgentContextError(
      "agent_context_identity_invalid",
      "The context namespace requires an existing hired agent.",
    );
  }
  const eventsById = new Map(
    input.events.flatMap((event) =>
      event.eventId === undefined ? [] : ([[event.eventId, event]] as const),
    ),
  );
  const eventById = (eventId: string) => eventsById.get(eventId) ?? input.lookupEvent?.(eventId);
  const entries: ProjectedAgentContextEntry[] = [];
  const handoffs: AgentContextProjection["incomingHandoffs"] = [];
  let lastSequence = 0;
  for (const envelope of input.events) {
    if (
      envelope.projectId !== input.projectId ||
      !Number.isSafeInteger(envelope.seq) ||
      envelope.seq <= lastSequence
    ) {
      throw new AgentContextError(
        "agent_context_event_invalid",
        "Agent context events must use the project event order and identity.",
      );
    }
    if (input.observedThroughSeq !== undefined && envelope.seq > input.observedThroughSeq) {
      throw new AgentContextError(
        "agent_context_event_invalid",
        "Agent context events must not follow the observed head.",
      );
    }
    lastSequence = envelope.seq;
    const event = agentContextEvent(envelope);
    if (event === null) continue;
    if (event.type === "agent.context.promoted")
      applyPromotion(entries, envelope, event.payload, eventById);
    else applyHandoff(entries, handoffs, input.agents, event.payload);
  }
  return {
    schemaVersion: 1,
    projectId: input.projectId,
    agent: structuredClone(agent),
    readOnly: agent.status === "retired",
    entries: entries
      .filter((entry) => entry.agentId === input.agentId)
      .sort((left, right) => left.contextEntryId.localeCompare(right.contextEntryId)),
    inheritedEntries: entries
      .filter((entry) =>
        handoffs.some(
          (handoff) =>
            handoff.toAgentId === input.agentId &&
            handoff.contextEntryIds.includes(entry.contextEntryId),
        ),
      )
      .sort((left, right) => left.contextEntryId.localeCompare(right.contextEntryId)),
    incomingHandoffs: handoffs
      .filter((handoff) => handoff.toAgentId === input.agentId)
      .sort((left, right) => left.contextHandoffId.localeCompare(right.contextHandoffId)),
    outgoingHandoffs: handoffs
      .filter((handoff) => handoff.fromAgentId === input.agentId)
      .sort((left, right) => left.contextHandoffId.localeCompare(right.contextHandoffId)),
    lastSequence: input.observedThroughSeq ?? lastSequence,
  };
}
