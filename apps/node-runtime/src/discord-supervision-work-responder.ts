import {
  readConversationControlMessage,
  createVerifiedConversationControlReply,
} from "@lervo/conversation-control";
import { realtimeConversationWritingContract } from "@lervo/core";
import type { ConversationResponder } from "@lervo/interaction";
import type { ConversationAgentBinding } from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";
import { operatingContractHash } from "@lervo/work-controller";

import { admitSupervisionRequest } from "./supervision-request-intake.js";
import type { NodeSupervisionStartupConfiguration } from "./supervision-startup-config.js";

/** Converts one admitted Discord work turn into the same canonical goal intake as local supervision. */
export class DiscordSupervisionWorkResponder implements ConversationResponder {
  constructor(
    private readonly options: {
      repositoryRoot: string;
      projectId: string;
      artifactStore: ArtifactStore;
      configuration: NodeSupervisionStartupConfiguration;
      policyId: string;
      speaker: { participantId: string; roleId: string; agentBinding?: ConversationAgentBinding };
      authorizedEffectRequesters: readonly {
        participantId: string;
        roleId: string;
        conversationId: string;
      }[];
      admitRequest?: typeof admitSupervisionRequest;
    },
  ) {}

  async respond(input: Parameters<ConversationResponder["respond"]>[0]) {
    const event = input.event;
    const authorized =
      event.actor.kind === "human" ||
      this.options.authorizedEffectRequesters.some(
        (requester) =>
          requester.participantId === event.actor.participantId &&
          requester.roleId === event.actor.roleId &&
          requester.conversationId === event.target.conversationId,
      );
    if (!authorized || event.target.projectId !== this.options.projectId)
      throw new Error("The supervised conversation requester is not authorized.");
    const request = await readConversationControlMessage({
      artifactStore: this.options.artifactStore,
      event,
    });
    const origin = {
      sourceEventId: event.eventId,
      policyId: this.options.policyId,
      target: event.target,
      actor: {
        kind: "agent" as const,
        participantId: this.options.speaker.participantId,
        roleId: this.options.speaker.roleId,
        ...(this.options.speaker.agentBinding === undefined
          ? {}
          : { agentBinding: this.options.speaker.agentBinding }),
      },
    };
    if (
      this.options.configuration.resultOrigin !== undefined &&
      operatingContractHash(this.options.configuration.resultOrigin) !==
        operatingContractHash(origin)
    )
      throw new Error("The supervised conversation differs from its installed result origin.");
    const admission = await (this.options.admitRequest ?? admitSupervisionRequest)({
      repositoryRoot: this.options.repositoryRoot,
      binding: this.options.configuration.binding,
      request: {
        source: "discord",
        sourceId: event.eventId,
        requesterId: `${event.actor.participantId}:${event.actor.roleId}`,
        request,
        contentHash: event.content.contentHash,
        origin,
      },
    });
    return createVerifiedConversationControlReply({
      artifactStore: this.options.artifactStore,
      writingContract: realtimeConversationWritingContract,
      content: admission.duplicate
        ? "동일한 요청은 이미 담당자의 작업 목표에 연결되어 있습니다."
        : "요청을 담당자의 현재 작업 목표에 연결했습니다. 검증된 결과는 이 대화로 전달하겠습니다.",
    });
  }
}
