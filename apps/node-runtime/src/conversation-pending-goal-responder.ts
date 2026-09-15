import { createVerifiedConversationControlReply } from "@lervo/conversation-control";
import { realtimeConversationWritingContract } from "@lervo/core";
import type { ConversationResponder } from "@lervo/interaction";
import type { ArtifactStore } from "@lervo/storage-contract";

import type { SQLiteConversationGoalIntakeStore } from "./conversation-goal-intake-store.js";

/** Records a durable goal receipt without claiming that execution authority exists. */
export class ConversationPendingGoalResponder implements ConversationResponder {
  constructor(
    private readonly options: {
      projectId: string;
      ownerAgentId: string;
      artifactStore: ArtifactStore;
      store: SQLiteConversationGoalIntakeStore;
      authorizedEffectRequesters: readonly {
        participantId: string;
        roleId: string;
        conversationId: string;
      }[];
      now?: () => Date;
    },
  ) {}

  async respond(input: Parameters<ConversationResponder["respond"]>[0]) {
    const { event } = input;
    const authorized =
      event.actor.kind === "human" ||
      this.options.authorizedEffectRequesters.some(
        (requester) =>
          requester.participantId === event.actor.participantId &&
          requester.roleId === event.actor.roleId &&
          requester.conversationId === event.target.conversationId,
      );
    if (!authorized || event.target.projectId !== this.options.projectId)
      throw new Error("The pending goal requester is not authorized.");
    const recorded = this.options.store.recordPending({
      event,
      ownerAgentId: this.options.ownerAgentId,
      createdAt: (this.options.now ?? (() => new Date()))().toISOString(),
    });
    return createVerifiedConversationControlReply({
      artifactStore: this.options.artifactStore,
      writingContract: realtimeConversationWritingContract,
      content: recorded.duplicate
        ? "이 목표 요청은 이미 보관되어 있습니다. 실행 권한이 설치되기 전에는 작업을 시작하지 않습니다."
        : "목표 요청을 보관했습니다. 현재 실행 권한은 설치되어 있지 않으므로 작업은 시작하지 않았습니다.",
      ...(this.options.now === undefined ? {} : { now: this.options.now }),
    });
  }
}
