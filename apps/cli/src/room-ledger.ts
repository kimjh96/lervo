// A room's records (Lervo ADE rooms, "State, events, privacy, and failure meaning"): what the
// router's decisions leave in the conversation's repository, by identifiers, counts, and times
// only. The router decides who a turn reaches; the ledger says what each decision records.
import type { ConversationNote } from "./conversation-notes.js";
import { providerSessionDigest } from "./hosted-session-events.js";
import { mentionIdOf, roomEventId, type RoomEvent } from "./room-events.js";

/** What a mention's delivery keeps for its records, from the conversation it came from. */
export interface RoomMention {
  readonly repositoryRoot: string;
  readonly provider: string;
  readonly workspaceId: string;
  readonly fromAgentId: string;
  readonly toAgentId: string;
  /** Whether the delivery brings its agent into the conversation for the first time. */
  readonly joins: boolean;
}

/** A delivered turn's receipt, which attests the note the agent keeps of it (ADR-0648). */
export interface RoomReceipt {
  readonly eventId: string;
  readonly mentionId: string;
  readonly mention: RoomMention;
}

/** Where a conversation's records go, when the core resolved its repository. */
interface RecordedConversation {
  readonly workspaceId: string;
  readonly repositoryRoot?: string;
  readonly provider?: string;
}

export class RoomLedger {
  constructor(
    private readonly now: () => number,
    /** Keeps the room's records; nothing reads them back here, and a failure is the caller's. */
    private readonly record: (repositoryRoot: string, events: RoomEvent[]) => void,
    /** Writes an agent's note after a turn a mention delivered (ADR-0648). */
    private readonly note: (note: ConversationNote) => void,
  ) {}

  /**
   * Records a mention becoming delivery `deliveryId`, and returns what its delivery keeps for the
   * records that follow. A conversation without a resolved repository records nothing.
   */
  mentioned(
    conversation: RecordedConversation,
    mention: { deliveryId: string; fromAgentId: string; toAgentId: string; depth: number },
    joins: boolean,
  ): RoomMention | undefined {
    const { repositoryRoot } = conversation;
    if (repositoryRoot === undefined) return undefined;
    this.record(repositoryRoot, [
      {
        type: "room.mention.recorded",
        payload: {
          workspaceId: conversation.workspaceId,
          mentionId: mentionIdOf(mention.deliveryId),
          fromAgentId: mention.fromAgentId,
          toAgentId: mention.toAgentId,
          depth: mention.depth,
          occurredAt: this.at(),
        },
      },
    ]);
    return {
      repositoryRoot,
      provider: conversation.provider ?? "claude",
      workspaceId: conversation.workspaceId,
      fromAgentId: mention.fromAgentId,
      toAgentId: mention.toAgentId,
      joins,
    };
  }

  /**
   * Records a mention's delivered turn: its receipt, after the agent's joining it brought. Returns
   * the receipt, which attests the note the agent keeps when the turn ends.
   */
  delivered(sessionId: string, deliveryId: string, mention: RoomMention): RoomReceipt {
    const occurredAt = this.at();
    const digest = providerSessionDigest(mention.provider, sessionId);
    const mentionId = mentionIdOf(deliveryId);
    const delivered: RoomEvent = {
      type: "room.mention.delivered",
      payload: { mentionId, providerSessionDigest: digest, occurredAt },
    };
    const events: RoomEvent[] = [delivered];
    if (mention.joins)
      events.unshift({
        type: "room.participant.joined",
        payload: {
          workspaceId: mention.workspaceId,
          agentId: mention.toAgentId,
          providerSessionDigest: digest,
          mentionedBy: mention.fromAgentId,
          occurredAt,
        },
      });
    this.record(mention.repositoryRoot, events);
    return { eventId: roomEventId(delivered), mentionId, mention };
  }

  /** Hands the note of a delivered turn's last message to the writer, off the answer path. */
  answered(receipt: RoomReceipt, text: string): void {
    this.note({
      repositoryRoot: receipt.mention.repositoryRoot,
      agentId: receipt.mention.toAgentId,
      workspaceId: receipt.mention.workspaceId,
      mentionId: receipt.mentionId,
      receiptEventId: receipt.eventId,
      text,
    });
  }

  /** Records an exchange the budget paused. */
  paused(
    conversation: RecordedConversation,
    pause: { agentTurnCount: number; limit: number; openerAgentId: string | null },
  ): void {
    if (conversation.repositoryRoot === undefined) return;
    this.record(conversation.repositoryRoot, [
      {
        type: "room.exchange.paused",
        payload: {
          workspaceId: conversation.workspaceId,
          agentTurnCount: Math.min(pause.agentTurnCount, 1000),
          limit: pause.limit,
          openerAgentId: pause.openerAgentId,
          occurredAt: this.at(),
        },
      },
    ]);
  }

  private at(): string {
    return new Date(this.now()).toISOString();
  }
}
