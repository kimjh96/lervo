import { createHash } from "node:crypto";

import type { ConversationContextTurn } from "@lervo/conversation-responder";
import type { ConversationAgentBinding, ConversationContentReference } from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";

import type {
  SQLiteConversationDiscussionStore,
  StoredConversationDiscussion,
} from "./conversation-discussion-store.js";

export function conversationContentReference(
  stored: Awaited<ReturnType<ArtifactStore["put"]>>,
): ConversationContentReference {
  return {
    artifactId: `art_${stored.contentHash.slice("sha256:".length, 60)}`,
    contentHash: stored.contentHash,
    byteCount: stored.byteCount,
    mediaType: "text/plain; charset=utf-8",
  };
}

export async function readConversationDiscussionContent(
  artifacts: ArtifactStore,
  content: ConversationContentReference,
): Promise<string> {
  const bytes = new Uint8Array(
    await artifacts.get(`lervo-cas://sha256/${content.contentHash.slice("sha256:".length)}`),
  );
  const hash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (bytes.byteLength !== content.byteCount || hash !== content.contentHash) {
    throw new Error("The discussion content does not match its stored coordinate.");
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function sameConversationAgentBinding(
  left: ConversationAgentBinding,
  right: ConversationAgentBinding,
): boolean {
  return (
    left.agentId === right.agentId &&
    left.roleVersion === right.roleVersion &&
    left.roleContractHash === right.roleContractHash &&
    left.roleProfileHash === right.roleProfileHash
  );
}

export function conversationDiscussionTurnId(discussionId: string, kind: string): string {
  return `dturn_${createHash("sha256").update(`${discussionId}:${kind}`).digest("hex").slice(0, 40)}`;
}

export function conversationDiscussionIdempotencyKey(discussionId: string): string {
  return `idk_${createHash("sha256").update(`${discussionId}:assignment`).digest("base64url").slice(0, 32)}`;
}

export async function buildConversationDiscussionDecisionContext(input: {
  artifacts: ArtifactStore;
  store: SQLiteConversationDiscussionStore;
  discussion: StoredConversationDiscussion;
  currentEventId: string;
  deadlineExpired?: boolean;
}): Promise<ConversationContextTurn[]> {
  const topic = await readConversationDiscussionContent(input.artifacts, input.discussion.topic);
  const contributions = await Promise.all(
    input.store
      .contributions(input.discussion.envelope.discussionId)
      .filter((contribution) => contribution.eventId !== input.currentEventId)
      .map(async (contribution) => ({
        contribution,
        text: await readConversationDiscussionContent(input.artifacts, contribution.content),
      })),
  );
  return [
    {
      role: "user",
      text: `Discussion topic and decision instruction:\n${topic}\n\n${
        input.deadlineExpired === true
          ? "The deadline expired before every invited agent contributed. Summarize only the verified contributions that arrived, state that the discussion did not converge, identify the missing evidence as an unresolved risk, and give the safest next action."
          : "Synthesize one final decision after comparing every accepted contribution."
      } State the conclusion, decisive evidence, unresolved risk, and next action. Do not invent participants or policy-role personas.`,
      speaker: {
        kind: "agent",
        participantId: input.discussion.envelope.source.participantId,
        agentId: input.discussion.envelope.source.agentBinding.agentId,
        roleId: input.discussion.envelope.source.roleId,
      },
    },
    ...contributions.map(({ contribution, text }) => ({
      role: "assistant" as const,
      text,
      speaker: {
        kind: "agent" as const,
        participantId: contribution.participantId,
        agentId: contribution.agentBinding.agentId,
        roleId: contribution.roleId,
      },
    })),
  ];
}
