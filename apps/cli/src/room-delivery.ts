// What the room router knows of a session's conversation, and the turns it hands the session host
// (Lervo ADE rooms, "Routing").
import type { TeamAgent } from "./workspace-participants.js";

/** What the core knows of a session's conversation, loaded when the session host names it. */
export interface RoomContext {
  readonly workspaceId: string;
  /** The project the conversation belongs to, which a conversation the agent starts shares. */
  readonly projectId: string;
  /** The registered repository, where the room's records go, when the core resolved it. */
  readonly repositoryRoot?: string;
  /** The session's provider, which a session's digest in the room's records names. */
  readonly provider?: string;
  /** The session's own agent. */
  readonly agentId: string;
  readonly team: readonly TeamAgent[];
  /** Each agent's session in the conversation; an agent without one joins on delivery. */
  readonly sessions: ReadonlyMap<string, string>;
}

/** A turn for the session host to give an agent, opening its session first when it has none. */
export interface RoomDelivery {
  readonly deliveryId: string;
  readonly workspaceId: string;
  readonly agentId: string;
  readonly sessionId: string | null;
  readonly text: string;
}
