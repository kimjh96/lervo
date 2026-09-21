import type { ArtifactStore } from "@lervo/storage-contract";

import {
  readConversationDiscussionContent,
  sameConversationAgentBinding,
} from "./conversation-discussion-evidence.js";
import { renderConversationDiscussionAssignment } from "./conversation-discussion-protocol.js";
import type {
  SQLiteConversationDiscussionStore,
  StoredConversationDiscussion,
} from "./conversation-discussion-store.js";
import type { DiscordPeerAgentBinding } from "./discord-conversation-composition.js";

/** Resolves the one uncompleted bound participant and renders its deterministic serial turn. */
export async function createNextConversationDiscussionAssignment(input: {
  discussion: StoredConversationDiscussion;
  peers: readonly DiscordPeerAgentBinding[];
  artifacts: ArtifactStore;
  store: SQLiteConversationDiscussionStore;
}): Promise<{ activeParticipantId: string; content: string }> {
  const completed = new Set(
    input.store
      .contributions(input.discussion.envelope.discussionId)
      .map((contribution) => contribution.participantId),
  );
  const remaining = input.discussion.envelope.targets.filter(
    (target) => !completed.has(target.participantId),
  );
  if (remaining.length !== 1) {
    throw new Error("A partial discussion must have exactly one remaining participant.");
  }
  const orderedTargets = [
    remaining[0]!,
    ...input.discussion.envelope.targets.filter(
      (target) => target.participantId !== remaining[0]!.participantId,
    ),
  ];
  const participants = orderedTargets.map((target) => {
    const matches = input.peers.filter(
      (peer) =>
        peer.participantId === target.participantId &&
        peer.roleId === target.roleId &&
        sameConversationAgentBinding(peer.agentBinding, target.agentBinding),
    );
    if (matches.length !== 1) {
      throw new Error("The next discussion participant binding is unavailable or ambiguous.");
    }
    const applicationIds = matches[0]!.participantKeys.flatMap((key) => {
      const match = /^bot:(\d{1,32})$/u.exec(key);
      return match === null ? [] : [match[1]!];
    });
    if (applicationIds.length !== 1) {
      throw new Error("The next discussion participant has no exact bot identity.");
    }
    return {
      participantId: target.participantId,
      roleId: target.roleId,
      displayName: matches[0]!.displayName ?? null,
      applicationId: applicationIds[0]!,
      agentBinding: structuredClone(target.agentBinding),
    };
  });
  const topic = await readConversationDiscussionContent(input.artifacts, input.discussion.topic);
  return {
    activeParticipantId: remaining[0]!.participantId,
    content: renderConversationDiscussionAssignment({
      participants,
      topic,
      language: /\p{Script=Hangul}/u.test(topic) ? "ko" : "en",
    }),
  };
}
