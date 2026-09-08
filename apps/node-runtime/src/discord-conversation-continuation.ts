import type { ConversationRemoteContinuationPort } from "@lervo/conversation-control";
import type { ConversationParticipationPolicy } from "@lervo/schemas";

import type { NodeDiscordConversationConfig } from "./config-types.js";
import type { SQLiteConversationResultStore } from "./conversation-result-store.js";

export function createDiscordConversationContinuation(input: {
  config: NodeDiscordConversationConfig;
  policy: ConversationParticipationPolicy;
  resultStore: SQLiteConversationResultStore;
  upstream: ConversationRemoteContinuationPort;
}): ConversationRemoteContinuationPort {
  return {
    request: async (request) => {
      const queued = await input.upstream.request(request);
      if (
        queued.provider !== input.config.command.provider ||
        queued.roleId !== input.config.command.roleId
      ) {
        throw new Error("The queued command differs from the Discord result policy.");
      }
      await input.resultStore.register({
        deliveryId: queued.deliveryId,
        commandId: queued.commandId,
        sourceEventId: request.eventId,
        target: {
          integrationId: input.config.integrationId,
          projectId: request.projectId,
          conversationId: request.conversationId,
          threadId: request.threadId,
        },
        policyId: input.policy.policyId,
        agentParticipantId: input.config.agentParticipantId,
        roleId: queued.roleId,
        provider: input.config.command.provider,
        workstreamId: queued.workstreamId,
        workstreamRevision: queued.workstreamRevision,
        workstreamSnapshotContentHash: queued.workstreamSnapshotContentHash,
        assignmentId: queued.assignmentId,
        agentId: queued.agentId,
        responseLanguage: /\p{Script=Hangul}/u.test(request.request) ? "ko" : "en",
        queuedAt: queued.queuedAt,
      });
      return queued;
    },
  };
}
