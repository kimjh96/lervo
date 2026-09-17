import {
  resolveConversationTurnOwnership,
  type ConversationTurnCandidate,
} from "@lervo/conversation-contract";
import type { ConversationTurnOwnershipEvaluator } from "@lervo/interaction";

import type { DiscordPeerAgentBinding } from "./discord-conversation-composition.js";
import type {
  ConversationTurnFocus,
  ConversationTurnFocusStore,
} from "./conversation-turn-focus-store.js";

class MemoryConversationTurnFocusStore implements ConversationTurnFocusStore {
  private readonly records = new Map<string, ConversationTurnFocus>();

  private key(focus: {
    projectId: string;
    conversationId: string;
    threadId: string | null;
  }): string {
    return `${focus.projectId}\0${focus.conversationId}\0${focus.threadId ?? ""}`;
  }

  read(scope: {
    projectId: string;
    conversationId: string;
    threadId: string | null;
  }): ConversationTurnFocus | null {
    return structuredClone(this.records.get(this.key(scope)) ?? null);
  }

  write(focus: ConversationTurnFocus): void {
    const key = this.key(focus);
    const current = this.records.get(key);
    const currentTime =
      current === undefined ? Number.NEGATIVE_INFINITY : Date.parse(current.lastEventAt);
    const nextTime = Date.parse(focus.lastEventAt);
    if (
      current !== undefined &&
      currentTime === nextTime &&
      current.lastSourceEventKeyHash === focus.lastSourceEventKeyHash &&
      current.participantId !== focus.participantId
    ) {
      throw new Error("One conversation event resolved to conflicting focused participants.");
    }
    if (
      current !== undefined &&
      (nextTime < currentTime ||
        (nextTime === currentTime &&
          focus.lastSourceEventKeyHash <= current.lastSourceEventKeyHash))
    ) {
      return;
    }
    if (this.records.size >= 1_024 && !this.records.has(key)) {
      this.records.delete(this.records.keys().next().value!);
    }
    this.records.set(key, structuredClone(focus));
  }

  remove(focus: ConversationTurnFocus): void {
    const current = this.records.get(this.key(focus));
    if (
      current?.participantId === focus.participantId &&
      current.lastEventAt === focus.lastEventAt &&
      current.lastSourceEventKeyHash === focus.lastSourceEventKeyHash
    ) {
      this.records.delete(this.key(focus));
    }
  }
}

export function createDiscordConversationTurnOwnership(input: {
  participantId: string;
  roleId: string;
  conversationIds: readonly string[];
  peers: readonly DiscordPeerAgentBinding[];
  focusStore?: ConversationTurnFocusStore;
}): ConversationTurnOwnershipEvaluator {
  const stickyOwnerIdleMs = 30 * 60_000;
  const focusStore = input.focusStore ?? new MemoryConversationTurnFocusStore();
  const current: ConversationTurnCandidate = {
    participantId: input.participantId,
    roleId: input.roleId,
    unaddressedPriority: input.roleId === "ceo" ? 100 : 0,
  };
  return {
    owns({ event }) {
      const candidates = [
        ...(input.conversationIds.includes(event.target.conversationId) ? [current] : []),
        ...input.peers.flatMap((peer) =>
          peer.conversationIds.includes(event.target.conversationId)
            ? [
                {
                  participantId: peer.participantId,
                  roleId: peer.roleId,
                  unaddressedPriority: peer.roleId === "ceo" ? 100 : 0,
                },
              ]
            : [],
        ),
      ];
      const explicitlyAddressed =
        event.mentions.participantIds.length > 0 || event.mentions.roleIds.length > 0;
      const resolved = resolveConversationTurnOwnership({ event, candidates });
      const atMs = Date.parse(event.occurredAt);
      const scope = {
        projectId: event.target.projectId,
        conversationId: event.target.conversationId,
        threadId: event.target.threadId,
      };
      if (
        event.actor.kind === "human" &&
        explicitlyAddressed &&
        resolved.ownerParticipantIds.length === 1
      ) {
        focusStore.write({
          ...scope,
          participantId: resolved.ownerParticipantIds[0]!,
          lastEventAt: event.occurredAt,
          lastSourceEventKeyHash: event.sourceEventKeyHash,
        });
      }
      const retained =
        event.actor.kind === "human" && !explicitlyAddressed
          ? (focusStore.read(scope) ?? undefined)
          : undefined;
      const retainedCandidate =
        retained === undefined
          ? undefined
          : candidates.find((candidate) => candidate.participantId === retained.participantId);
      if (retained !== undefined && retainedCandidate === undefined) focusStore.remove(retained);
      const expired =
        retainedCandidate !== undefined &&
        Number.isFinite(atMs) &&
        atMs - Date.parse(retained!.lastEventAt) > stickyOwnerIdleMs;
      if (expired) focusStore.remove(retained!);
      const sticky = expired || retainedCandidate === undefined ? undefined : retained;
      if (sticky !== undefined && Number.isFinite(atMs)) {
        focusStore.write({
          ...sticky,
          lastEventAt: event.occurredAt,
          lastSourceEventKeyHash: event.sourceEventKeyHash,
        });
      }
      return (
        sticky === undefined ? resolved.ownerParticipantIds : [sticky.participantId]
      ).includes(input.participantId);
    },
  };
}
