/**
 * The results of the room commands of the core link (Lervo ADE rooms, "The core link and the
 * session host"): an agent joining a conversation, and where the owner's turn goes.
 */
import type { FromSchema } from "json-schema-to-ts";

import { identifierSchema } from "./primitives.js";

/** How many agents one conversation holds: those it started with and those who joined. */
export const MAXIMUM_ROOM_AGENTS = 16;

/** One participant's session in a conversation. */
export const roomSessionSchema = {
  title: "RoomSession",
  type: "object",
  required: ["agentId", "sessionId", "access"],
  properties: {
    agentId: identifierSchema,
    sessionId: identifierSchema,
    /** `write` for the lead, `read` for an agent that joined. */
    access: { enum: ["write", "read"] },
  },
} as const;

/** `room.join`: the agent's session in the conversation, whose launch the answer carries. */
export const roomJoinResultSchema = {
  title: "RoomJoinResult",
  type: "object",
  required: ["workspaceId", "sessionId", "agentId", "provider", "resumed"],
  properties: {
    workspaceId: identifierSchema,
    sessionId: identifierSchema,
    agentId: identifierSchema,
    provider: { type: "string", minLength: 1, maxLength: 32 },
    /** Whether the agent's earlier session in the conversation continues. */
    resumed: { type: "boolean" },
    /**
     * The session is the conversation's own: the lead of a conversation it started, whose session
     * opens from the delivered first turn (Lervo ADE rooms, slice 2). Absent for an agent that joins.
     */
    lead: { const: true },
  },
} as const;

/** `room.route`: the agents an owner's turn goes to, in order; empty for the lead without one. */
export const roomRouteResultSchema = {
  title: "RoomRouteResult",
  type: "object",
  required: ["agents"],
  properties: {
    agents: { type: "array", maxItems: MAXIMUM_ROOM_AGENTS, items: identifierSchema },
  },
} as const;

export type RoomSession = FromSchema<typeof roomSessionSchema>;
export type RoomJoinResult = FromSchema<typeof roomJoinResultSchema>;
export type RoomRouteResult = FromSchema<typeof roomRouteResultSchema>;
