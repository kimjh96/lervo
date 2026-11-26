// One conversation from its agents' sessions (Lervo ADE rooms, "The ADE").
import type { ConversationItem } from "@lervo/session-host-contract";

import type { ConversationWindow } from "./window";

/** An agent that joined the conversation, and what its own session holds. */
export interface MemberLane {
  readonly agentId: string;
  readonly sessionId: string;
  readonly window: ConversationWindow;
}

/** The conversation as one timeline, and the agent that said or did each item. */
export interface RoomView {
  readonly window: ConversationWindow;
  /** The agent of each item an agent produced, by item ID. */
  readonly speakers: ReadonlyMap<string, string>;
  /** Items before which the speaking agent changed, so a speaker line precedes them. */
  readonly changes: ReadonlySet<string>;
}

/** How close in time two copies of the owner's turn are, when it went to several agents. */
const SAME_TURN_MS = 10_000;

function spokenByAgent(item: ConversationItem): boolean {
  return item.kind === "agent_message" || item.kind === "tool_activity" || item.kind === "question";
}

/**
 * Interleaves the lead's window with the sessions of the agents that joined, by time. A delivered
 * turn repeats a message the timeline already shows, so peer messages leave a room's timeline,
 * and the owner's turn sent to several agents shows once. A member's items older than the lead's
 * window wait until that window reaches them, so earlier pages stay in order. A conversation
 * without members is the lead's window unchanged.
 */
export function roomView(
  lead: ConversationWindow,
  leadAgentId: string | null,
  members: readonly MemberLane[],
): RoomView {
  if (members.length === 0) return { window: lead, speakers: new Map(), changes: new Set() };
  const start = lead.hasEarlier ? (lead.items[0]?.createdAtMs ?? 0) : 0;
  const tagged: { item: ConversationItem; agentId: string | null; order: number }[] = [];
  lead.items.forEach((item, order) => tagged.push({ item, agentId: leadAgentId, order }));
  for (const member of members)
    member.window.items.forEach((item, order) => {
      if (item.createdAtMs < start) return;
      tagged.push({
        item: { ...item, itemId: `${member.sessionId}:${item.itemId}` },
        agentId: member.agentId,
        order: lead.items.length + order,
      });
    });
  const owner: { text: string; at: number }[] = [];
  const kept = tagged
    .toSorted((a, b) => a.item.createdAtMs - b.item.createdAtMs || a.order - b.order)
    .filter(({ item }) => {
      if (item.kind === "peer_message") return false;
      if (item.kind !== "user_message") return true;
      if (
        owner.some(
          (seen) => seen.text === item.text && Math.abs(seen.at - item.createdAtMs) < SAME_TURN_MS,
        )
      )
        return false;
      owner.push({ text: item.text, at: item.createdAtMs });
      return true;
    });
  const speakers = new Map<string, string>();
  const changes = new Set<string>();
  let previous: string | null = null;
  for (const { item, agentId } of kept) {
    if (item.kind === "user_message") {
      previous = null;
      continue;
    }
    if (!spokenByAgent(item) || agentId === null) continue;
    speakers.set(item.itemId, agentId);
    if (agentId !== previous) changes.add(item.itemId);
    previous = agentId;
  }
  return {
    window: { ...lead, items: kept.map(({ item }) => item) },
    speakers,
    changes,
  };
}
