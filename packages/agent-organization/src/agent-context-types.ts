import type {
  AgentContextHandoffRecordedEventPayload,
  AgentContextPromotedEventPayload,
} from "@lervo/schemas";

import type { AgentOrganizationEventEnvelope } from "./types.js";

export type AgentContextEvent =
  | { type: "agent.context.promoted"; payload: AgentContextPromotedEventPayload }
  | {
      type: "agent.context.handoff.recorded";
      payload: AgentContextHandoffRecordedEventPayload;
    };

export interface AgentContextWorkforceIdentity {
  agentId: string;
  roleId: string;
  roleVersion: string;
  roleContractHash: string;
  roleProfileHash: string;
  provider: "codex" | "claude" | "any";
  responsibilityPaths: readonly string[];
  parentAgentId: string | null;
  status: "active" | "suspended" | "retired";
}

export interface ProjectedAgentContextEntry extends AgentContextPromotedEventPayload {
  status: "active" | "superseded";
}

export interface AgentContextProjection {
  schemaVersion: 1;
  projectId: string;
  agent: AgentContextWorkforceIdentity;
  readOnly: boolean;
  entries: ProjectedAgentContextEntry[];
  inheritedEntries: ProjectedAgentContextEntry[];
  incomingHandoffs: AgentContextHandoffRecordedEventPayload[];
  outgoingHandoffs: AgentContextHandoffRecordedEventPayload[];
  lastSequence: number;
}

export type AgentContextEventEnvelope = AgentOrganizationEventEnvelope & {
  eventId?: string;
  eventHash?: string;
};

export class AgentContextError extends Error {
  constructor(
    readonly code:
      | "agent_context_event_invalid"
      | "agent_context_identity_invalid"
      | "agent_context_state_conflict",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AgentContextError";
  }
}
