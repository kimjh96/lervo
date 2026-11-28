// The work a finished turn hands out (Lervo ADE rooms, "How an agent starts a conversation";
// ADR-0657): the first turn of each conversation its agent started, for itself or a teammate to
// lead, and each request it sent to a conversation a teammate already leads. Each becomes a
// delivery to the lead and a line in both conversations.
import type { HostedDecodedEvent } from "@lervo/adapter-contract";

import { envelopeText } from "./room-envelope.js";
import type { RoomDelivery } from "./room-delivery.js";
import type { PendingSend } from "./room-sends.js";
import { type PendingStart, starterOf } from "./room-starts.js";
import type { TeamAgent } from "./workspace-participants.js";

/** The line a handed-out turn opens with in the conversation it reaches. */
export interface HandOffOrigin {
  readonly code: "conversation_started_by" | "work_sent_from";
  /** The conversation it came from, which the line opens. */
  readonly workspace: string;
}

/** One handed-out turn: its delivery, the line it leaves here, and the line it opens with there. */
export interface HandOff {
  readonly delivery: RoomDelivery;
  readonly line: { readonly code: string; readonly parameters: Record<string, string> };
  readonly origin: HandOffOrigin;
}

/** The conversations `self` started that its turn's end opens. */
export function startHandOffs(
  self: TeamAgent,
  workspaceId: string,
  starts: readonly PendingStart[],
  newId: () => string,
): HandOff[] {
  return starts
    .filter((start) => starterOf(start) === self.agentId)
    .map((start) => ({
      delivery: {
        deliveryId: newId(),
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
      },
      line: {
        code: "conversation_started",
        parameters: { agent: self.displayName, title: start.title, workspace: start.workspaceId },
      },
      origin: { code: "conversation_started_by", workspace: workspaceId },
    }));
}

/** The work `self` sent to teammates' conversations that its turn's end delivers. */
export function sendHandOffs(
  self: TeamAgent,
  workspaceId: string,
  sends: readonly PendingSend[],
  newId: () => string,
): HandOff[] {
  return sends
    .filter((send) => send.sentBy === self.agentId)
    .map((send) => ({
      delivery: {
        deliveryId: newId(),
        workspaceId: send.workspaceId,
        agentId: send.agentId,
        sessionId: send.sessionId,
        text: envelopeText({
          from: self.displayName,
          role: self.roleName,
          message: send.text,
          recent: [],
          reason: "sent",
        }),
      },
      line: {
        code: "work_sent",
        parameters: { agent: self.displayName, title: send.title, workspace: send.workspaceId },
      },
      origin: { code: "work_sent_from", workspace: workspaceId },
    }));
}

/** The events and deliveries of `handOffs`, as a finished turn returns them. */
export function handOffOutput(
  handOffs: readonly HandOff[],
  notice: (code: string, parameters: Record<string, string>) => HostedDecodedEvent,
): { events: HostedDecodedEvent[]; deliveries: RoomDelivery[] } {
  return {
    events: handOffs.map((handOff) => notice(handOff.line.code, handOff.line.parameters)),
    deliveries: handOffs.map((handOff) => handOff.delivery),
  };
}
