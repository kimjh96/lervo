import {
  validateSchema,
  type AgentContextHandoffRecordedEventPayload,
  type AgentContextPromotedEventPayload,
  type SchemaName,
} from "@lervo/schemas";

import {
  AgentContextError,
  type AgentContextEvent,
  type AgentContextEventEnvelope,
} from "./agent-context-types.js";

const schemaByType = {
  "agent.context.promoted": "agentContextPromotedEventPayload",
  "agent.context.handoff.recorded": "agentContextHandoffRecordedEventPayload",
} as const satisfies Record<AgentContextEvent["type"], SchemaName>;

/** Every event type the agent-context projection consumes; a typed read of them is sufficient. */
export const agentContextEventTypes = Object.keys(
  schemaByType,
) as readonly AgentContextEvent["type"][];

export function isAgentContextEventType(type: string): type is AgentContextEvent["type"] {
  return Object.hasOwn(schemaByType, type);
}

export function agentContextEvent(envelope: AgentContextEventEnvelope): AgentContextEvent | null {
  if (!isAgentContextEventType(envelope.type)) return null;
  if (!validateSchema(schemaByType[envelope.type], envelope.payload).valid) {
    throw new AgentContextError(
      "agent_context_event_invalid",
      `The ${envelope.type} payload is invalid.`,
    );
  }
  return envelope.type === "agent.context.promoted"
    ? {
        type: envelope.type,
        payload: envelope.payload as AgentContextPromotedEventPayload,
      }
    : {
        type: envelope.type,
        payload: envelope.payload as AgentContextHandoffRecordedEventPayload,
      };
}
