import { agentContextEvent } from "./agent-context-event-validation.js";
import {
  AgentContextError,
  type AgentContextEventEnvelope,
  type AgentContextProjection,
  type AgentContextWorkforceIdentity,
  type ProjectedAgentContextEntry,
} from "./agent-context-types.js";

const reviewEventTypes = new Set([
  "knowledge.candidate.reviewed",
  "knowledge.reconciliation.reviewed",
  "knowledge.verified",
  "verification.completed",
]);

function conflict(message: string): never {
  throw new AgentContextError("agent_context_state_conflict", message);
}

function artifactId(contentHash: string): string {
  return `art_${contentHash.slice("sha256:".length)}`;
}

function passedVerification(event: AgentContextEventEnvelope): boolean {
  if (event.type !== "verification.completed") return true;
  return (
    typeof event.payload === "object" &&
    event.payload !== null &&
    "status" in event.payload &&
    event.payload.status === "passed"
  );
}

function assertSourceAndReview(
  envelope: AgentContextEventEnvelope,
  eventsById: ReadonlyMap<string, AgentContextEventEnvelope>,
): void {
  const payload = agentContextEvent(envelope)?.payload;
  if (payload === undefined || !("reviewEventId" in payload)) return;
  if (payload.summaryArtifactId !== artifactId(payload.summaryContentHash)) {
    conflict("The promoted context summary artifact coordinate is invalid.");
  }
  const review = eventsById.get(payload.reviewEventId);
  if (
    review === undefined ||
    review.eventHash !== payload.reviewEventHash ||
    !reviewEventTypes.has(review.type) ||
    !passedVerification(review)
  ) {
    conflict("The context promotion review evidence is missing or ineligible.");
  }
  if (payload.source.kind === "event") {
    const source = eventsById.get(payload.source.sourceId);
    if (source === undefined || source.eventHash !== payload.source.contentHash) {
      conflict("The context promotion source event does not match its exact hash.");
    }
  } else if (payload.source.sourceId !== artifactId(payload.source.contentHash)) {
    conflict("The context promotion source artifact coordinate is invalid.");
  }
}

export function projectAgentContext(input: {
  projectId: string;
  agentId: string;
  agents: readonly AgentContextWorkforceIdentity[];
  events: readonly AgentContextEventEnvelope[];
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
    lastSequence = envelope.seq;
    const event = agentContextEvent(envelope);
    if (event === null) continue;
    if (event.type === "agent.context.promoted") {
      assertSourceAndReview(envelope, eventsById);
      const payload = event.payload;
      if (entries.some((entry) => entry.contextEntryId === payload.contextEntryId)) {
        conflict("An agent context entry ID cannot be reused.");
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
          conflict(
            "A context promotion can supersede only one active entry in the same namespace.",
          );
        }
        prior.status = "superseded";
      }
      entries.push({ ...structuredClone(payload), status: "active" });
      continue;
    }
    const payload = event.payload;
    if (
      payload.fromAgentId === payload.toAgentId ||
      !input.agents.some((candidate) => candidate.agentId === payload.fromAgentId) ||
      !input.agents.some(
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
    handoffs.push(structuredClone(payload));
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
    lastSequence,
  };
}
