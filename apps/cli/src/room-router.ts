// Routing between a conversation's agents inside the resident core (Lervo ADE rooms, "Routing").
import type { HostedDecodedContent, HostedDecodedEvent } from "@lervo/adapter-contract";

import { envelopeText, readEnvelope, type RoomTurn } from "./room-envelope.js";
import type { RoomEvent } from "./room-events.js";
import type { ConversationNote } from "./conversation-notes.js";
import { RoomLedger, type RoomMention, type RoomReceipt } from "./room-ledger.js";
import { mentionedAgents, turnTargets } from "./room-mentions.js";
import { type PendingStart, starterOf } from "./room-starts.js";
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

/** ADR-0454's exchange budget, and the depth of a chain from the turn that started it. */
export const EXCHANGE_LIMIT = 12;
export const EXCHANGE_WINDOW_MS = 10 * 60_000;
export const EXCHANGE_DEPTH = 8;
const RECENT_KEPT = 16;
/** Deliveries the session host has not sent yet; past this the oldest are forgotten. */
const PENDING_DELIVERIES = 256;
const OWNER = "Owner";

interface Room {
  recent: RoomTurn[];
  /** When each agent-to-agent delivery of the current window went out. */
  deliveredAt: number[];
  /** The agent whose turn the owner started, which summarizes a paused exchange. */
  opener: string | null;
  paused: boolean;
  /** Agents that owe an answer, and the agents waiting for it. */
  owed: Map<string, Set<string>>;
}

/**
 * A turn the router handed the session host. A mention's delivery keeps what its records need,
 * from the conversation it came from, since the receiving session's own context may load later.
 */
interface Delivery {
  depth: number;
  from: string;
  startedIn?: string;
  mention?: RoomMention;
}

interface SessionTurn {
  depth: number;
  /** The receipt of the mention that delivered this turn, which attests the agent's note. */
  receipt?: RoomReceipt | undefined;
  /** The agent message the turn ended with: the last one it published. */
  last: string | null;
  streaming: string | null;
}

/**
 * Follows every room session's turns and decides what each finished turn sets off: a delivery for
 * each agent it mentions, the answer back to an agent that asked, or a pause at the exchange
 * budget. It keeps only bounded memory of each conversation, and nothing on disk.
 */
export class RoomRouter {
  private readonly contexts = new Map<string, RoomContext>();
  private readonly rooms = new Map<string, Room>();
  private readonly turns = new Map<string, SessionTurn>();
  private readonly deliveries = new Map<string, Delivery>();
  private readonly ledger: RoomLedger;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly newId: () => string = () => crypto.randomUUID(),
    /** Keeps the room's records; nothing reads them back here, and a failure is the caller's. */
    record: (repositoryRoot: string, events: RoomEvent[]) => void = () => undefined,
    /** Writes an agent's note after a turn a mention delivered (ADR-0648). */
    note: (note: ConversationNote) => void = () => undefined,
  ) {
    this.ledger = new RoomLedger(now, record, note);
  }

  /** Records what the core loaded about a session's conversation. */
  know(sessionId: string, context: RoomContext): void {
    this.contexts.set(sessionId, context);
  }

  /** The agent of a session whose conversation the core loaded, or null. */
  agentOf(sessionId: string): string | null {
    return this.contexts.get(sessionId)?.agentId ?? null;
  }

  /** The display name of an agent of the session's team, or null when the team lacks it. */
  nameOf(sessionId: string, agentId: string): string | null {
    const team = this.contexts.get(sessionId)?.team ?? [];
    return team.find((agent) => agent.agentId === agentId)?.displayName ?? null;
  }

  /**
   * The deliveries that open the conversations a session's agent started, when its turn ends
   * (Lervo ADE rooms, "How an agent starts a conversation"), and the line each adds here.
   */
  starts(
    sessionId: string,
    starts: readonly PendingStart[],
  ): { events: HostedDecodedEvent[]; deliveries: RoomDelivery[] } {
    const context = this.contexts.get(sessionId);
    const self = context?.team.find((agent) => agent.agentId === context.agentId);
    if (context === undefined || self === undefined) return { events: [], deliveries: [] };
    const events: HostedDecodedEvent[] = [];
    const deliveries: RoomDelivery[] = [];
    for (const start of starts) {
      // The starter's turn delivers the first turn to the lead, itself or a teammate (ADR-0657).
      if (starterOf(start) !== self.agentId) continue;
      const deliveryId = this.newId();
      this.deliveries.set(deliveryId, {
        depth: 0,
        from: self.displayName,
        startedIn: context.workspaceId,
      });
      events.push(
        this.notice("conversation_started", {
          agent: self.displayName,
          title: start.title,
          workspace: start.workspaceId,
        }),
      );
      deliveries.push({
        deliveryId,
        workspaceId: start.workspaceId,
        agentId: start.agentId,
        sessionId: null,
        text: envelopeText({
          from: self.displayName,
          role: self.roleName,
          message: start.text,
          recent: [],
          reason: start.agentId === self.agentId ? "start" : "handed",
        }),
      });
    }
    return { events, deliveries };
  }

  /** Forgets a session whose decoder closed. */
  forget(sessionId: string): void {
    this.contexts.delete(sessionId);
    this.turns.delete(sessionId);
  }

  private room(workspaceId: string): Room {
    let room = this.rooms.get(workspaceId);
    if (room === undefined) {
      room = { recent: [], deliveredAt: [], opener: null, paused: false, owed: new Map() };
      this.rooms.set(workspaceId, room);
    }
    return room;
  }

  private remember(room: Room, turn: RoomTurn): void {
    const last = room.recent.at(-1);
    // The owner's turn sent to several agents is one turn.
    if (last?.speaker === turn.speaker && last.text === turn.text) return;
    room.recent.push(turn);
    if (room.recent.length > RECENT_KEPT) room.recent.splice(0, room.recent.length - RECENT_KEPT);
  }

  /**
   * What `send` showed for a turn the session host wrote: the owner's own text, or a delivery,
   * which shows as the sender's message. The owner's turn starts a new exchange.
   */
  sent(
    sessionId: string,
    deliveryId: string | undefined,
    events: readonly HostedDecodedEvent[],
  ): HostedDecodedEvent[] {
    const context = this.contexts.get(sessionId);
    const delivery = deliveryId === undefined ? undefined : this.deliveries.get(deliveryId);
    if (deliveryId !== undefined) this.deliveries.delete(deliveryId);
    const receipt =
      deliveryId !== undefined && delivery?.mention !== undefined
        ? this.ledger.delivered(sessionId, deliveryId, delivery.mention)
        : undefined;
    this.turns.set(sessionId, {
      depth: delivery?.depth ?? 0,
      last: null,
      streaming: null,
      receipt,
    });
    return events.flatMap((event): HostedDecodedEvent[] => {
      if (event.kind !== "item" || event.content.kind !== "user_message") return [event];
      if (deliveryId !== undefined) {
        // A delivered turn is never the owner's: it shows as its sender's message, or not at all
        // when it only asks for a summary that the paused line already announced.
        const read = readEnvelope(event.content.text);
        if (read === null) return [];
        const peer: HostedDecodedEvent = {
          ...event,
          content: { kind: "peer_message", from: read.from, text: read.message },
        };
        // A conversation an agent started opens with who started it, and from where.
        return delivery?.startedIn === undefined
          ? [peer]
          : [
              this.notice("conversation_started_by", {
                agent: read.from,
                workspace: delivery.startedIn,
              }),
              peer,
            ];
      }
      if (context !== undefined) {
        const room = this.room(context.workspaceId);
        this.remember(room, { speaker: OWNER, text: event.content.text });
        room.deliveredAt = [];
        room.paused = false;
        room.opener = context.agentId;
      }
      return [event];
    });
  }

  /** Follows a session's decoded output, and answers what its finished turn sets off. */
  observe(
    sessionId: string,
    events: readonly HostedDecodedEvent[],
  ): { events: HostedDecodedEvent[]; deliveries: RoomDelivery[] } {
    const context = this.contexts.get(sessionId);
    if (context === undefined) return { events: [...events], deliveries: [] };
    const turn = this.turns.get(sessionId) ?? { depth: 0, last: null, streaming: null };
    this.turns.set(sessionId, turn);
    const shown: HostedDecodedEvent[] = [];
    const deliveries: RoomDelivery[] = [];
    for (const event of events) {
      shown.push(event);
      this.follow(turn, event);
      if (event.kind === "status" && event.event === "turn_finished") {
        const finished = this.finish(context, turn);
        shown.push(...finished.events);
        deliveries.push(...finished.deliveries);
      }
    }
    return { events: shown, deliveries };
  }

  private follow(turn: SessionTurn, event: HostedDecodedEvent): void {
    const agentText = (content: HostedDecodedContent) =>
      content.kind === "agent_message" ? content.text : null;
    if (event.kind === "item") turn.last = agentText(event.content) ?? turn.last;
    else if (event.kind === "start") turn.streaming = agentText(event.content);
    else if (event.kind === "delta" && turn.streaming !== null) turn.streaming += event.text;
    else if (event.kind === "finish" && turn.streaming !== null) {
      turn.last = turn.streaming;
      turn.streaming = null;
    }
  }

  private finish(context: RoomContext, turn: SessionTurn) {
    const events: HostedDecodedEvent[] = [];
    const deliveries: RoomDelivery[] = [];
    const text = turn.last;
    turn.last = null;
    const receipt = turn.receipt;
    delete turn.receipt;
    // One note per delivered turn, from the last message the agent published in it.
    if (receipt !== undefined && text !== null) this.ledger.answered(receipt, text);
    const self = context.team.find((agent) => agent.agentId === context.agentId);
    if (text === null || self === undefined) return { events, deliveries };
    const room = this.room(context.workspaceId);
    const recalled = [...room.recent];
    this.remember(room, { speaker: self.displayName, text });
    const mentioned = mentionedAgents(text, context.team).filter((id) => id !== self.agentId);
    const owed = room.owed.get(self.agentId) ?? new Set<string>();
    const { targets, settled } = turnTargets(mentioned, owed);
    for (const id of settled) owed.delete(id);
    if (owed.size === 0) room.owed.delete(self.agentId);
    if (targets.length === 0) return { events, deliveries };
    const now = this.now();
    room.deliveredAt = room.deliveredAt.filter((at) => now - at < EXCHANGE_WINDOW_MS);
    if (room.paused) return { events, deliveries };
    if (
      turn.depth + 1 > EXCHANGE_DEPTH ||
      room.deliveredAt.length + targets.length > EXCHANGE_LIMIT
    ) {
      room.paused = true;
      events.push(
        this.notice("room_paused", { turns: room.deliveredAt.length, limit: EXCHANGE_LIMIT }),
      );
      this.ledger.paused(context, {
        agentTurnCount: room.deliveredAt.length,
        limit: EXCHANGE_LIMIT,
        openerAgentId: room.opener,
      });
      const opener = context.team.find((agent) => agent.agentId === room.opener);
      if (opener !== undefined)
        deliveries.push(
          this.deliver(
            context,
            opener.agentId,
            turn.depth,
            self,
            [
              "[Lervo room] Agents paused after reaching the exchange budget.",
              "Summarize the exchange for the owner. Hand whatever is still open to the product owner as a decision; never wait on the owner.",
            ].join("\n"),
          ),
        );
      return { events, deliveries };
    }
    for (const target of targets) {
      const agent = context.team.find((item) => item.agentId === target.agentId);
      if (agent === undefined) continue;
      room.deliveredAt.push(now);
      if (target.reason === "mention") {
        const owed = room.owed.get(agent.agentId) ?? new Set<string>();
        owed.add(self.agentId);
        room.owed.set(agent.agentId, owed);
      }
      if (!context.sessions.has(agent.agentId))
        events.push(this.notice("room_joined", { agent: agent.displayName, by: self.displayName }));
      deliveries.push(
        this.deliver(
          context,
          agent.agentId,
          turn.depth + 1,
          self,
          envelopeText({
            from: self.displayName,
            role: self.roleName,
            message: text,
            recent: recalled,
            reason: target.reason,
          }),
        ),
      );
    }
    return { events, deliveries };
  }

  private deliver(
    context: RoomContext,
    agentId: string,
    depth: number,
    from: TeamAgent,
    text: string,
  ): RoomDelivery {
    const deliveryId = this.newId();
    const mention = this.ledger.mentioned(
      context,
      {
        deliveryId,
        fromAgentId: from.agentId,
        toAgentId: agentId,
        depth: Math.min(depth, EXCHANGE_DEPTH),
      },
      !context.sessions.has(agentId),
    );
    this.deliveries.set(deliveryId, {
      depth,
      from: from.displayName,
      ...(mention === undefined ? {} : { mention }),
    });
    if (this.deliveries.size > PENDING_DELIVERIES)
      this.deliveries.delete(this.deliveries.keys().next().value as string);
    return {
      deliveryId,
      workspaceId: context.workspaceId,
      agentId,
      sessionId: context.sessions.get(agentId) ?? null,
      text,
    };
  }

  private notice(code: string, parameters: Record<string, string | number>): HostedDecodedEvent {
    return {
      kind: "item",
      content: { kind: "lervo_notice", code, parameters },
      createdAtMs: this.now(),
    };
  }
}
