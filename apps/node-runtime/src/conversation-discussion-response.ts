import { createVerifiedConversationControlReply } from "@lervo/conversation-control";
import { fixedConversationStatusWritingContract } from "@lervo/core";
import type { ConversationReplyCandidate, ConversationResponder } from "@lervo/interaction";
import type { ArtifactStore } from "@lervo/storage-contract";

import type {
  ConversationDiscussionDirective,
  ConversationDiscussionRuntime,
} from "./conversation-discussion-runtime.js";

export async function respondToConversationDiscussion(input: {
  directive: ConversationDiscussionDirective;
  request: Parameters<ConversationResponder["respond"]>[0];
  readOnly: ConversationResponder;
  discussion: ConversationDiscussionRuntime | undefined;
  artifactStore: ArtifactStore;
}): Promise<ConversationReplyCandidate | null> {
  if (input.directive.kind === "failure") {
    const candidate = await createVerifiedConversationControlReply({
      artifactStore: input.artifactStore,
      writingContract: fixedConversationStatusWritingContract,
      content: input.directive.content,
    });
    candidate.deliveryRelation = "reply";
    candidate.coordination = {
      kind: "discussion.decision",
      discussionId: input.directive.discussionId,
    };
    candidate.audienceParticipation = "observe_only";
    input.discussion?.markFailed({
      discussionId: input.directive.discussionId,
      eventId: input.request.event.eventId,
      occurredAt: new Date().toISOString(),
    });
    return candidate;
  }
  if (input.directive.kind === "next_assignment") {
    const candidate = await createVerifiedConversationControlReply({
      artifactStore: input.artifactStore,
      writingContract: fixedConversationStatusWritingContract,
      content: input.directive.content,
    });
    candidate.deliveryRelation = "reply";
    candidate.coordination = {
      kind: "discussion.assignment",
      discussionId: input.directive.discussionId,
      activeParticipantId: input.directive.activeParticipantId,
      assignmentSequence: 2,
    };
    candidate.audienceParticipation = "eligible";
    return candidate;
  }
  if (input.directive.kind !== "assignment" && input.directive.kind !== "decision") return null;
  const candidate = await input.readOnly.respond(input.request);
  candidate.deliveryRelation = "reply";
  candidate.coordination = {
    kind: input.directive.kind === "assignment" ? "discussion.contribution" : "discussion.decision",
    discussionId: input.directive.discussionId,
  };
  if (input.directive.kind === "decision") {
    candidate.audienceParticipation = "observe_only";
    const terminal = {
      discussionId: input.directive.discussionId,
      eventId: input.request.event.eventId,
      occurredAt: new Date().toISOString(),
    };
    if (input.directive.terminalState === "converged") {
      input.discussion?.markConverged(terminal);
    } else {
      input.discussion?.markFailed(terminal);
    }
  }
  return candidate;
}
