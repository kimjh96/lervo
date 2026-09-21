import type { ConversationCoordination } from "@lervo/schemas";

import type { DiscordMessageCoordination } from "./message-nonce.js";

export type DiscordInboundCoordination =
  | { status: "none" }
  | { status: "unmapped" }
  | { status: "mapped"; coordination: ConversationCoordination };

/** Binds transport-authenticated coordination to normalized participant identities. */
export function mapDiscordInboundCoordination(input: {
  coordination: DiscordMessageCoordination | null;
  actorParticipantId: string;
  primaryMentionedParticipantId: string | null;
}): DiscordInboundCoordination {
  const coordination = input.coordination;
  if (coordination === null) return { status: "none" };
  if (coordination.kind === "discussion.assignment") {
    return input.primaryMentionedParticipantId === null
      ? { status: "unmapped" }
      : {
          status: "mapped",
          coordination: {
            ...coordination,
            activeParticipantId: input.primaryMentionedParticipantId,
          },
        };
  }
  if (coordination.kind === "task.assignment") {
    return input.primaryMentionedParticipantId === null
      ? { status: "unmapped" }
      : {
          status: "mapped",
          coordination: {
            kind: coordination.kind,
            taskId: coordination.taskId,
            coordinatorParticipantId: input.actorParticipantId,
          },
        };
  }
  if (coordination.kind === "task.result") {
    return input.primaryMentionedParticipantId === null
      ? { status: "unmapped" }
      : {
          status: "mapped",
          coordination: {
            kind: coordination.kind,
            taskId: coordination.taskId,
            coordinatorParticipantId: input.primaryMentionedParticipantId,
          },
        };
  }
  return { status: "mapped", coordination };
}
