import {
  createConversationInboundEvent,
  hashConversationSourceEventKey,
} from "@lervo/conversation-contract";
import type { HandleConversationEventResult } from "@lervo/interaction";
import type { ConversationInboundEvent, ConversationOutboundMessage } from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";

import type { DiscordPeerAgentBinding } from "./discord-conversation-composition.js";

const maximumAutomationDepth = 8;

type ConversationAgentActor = ConversationInboundEvent["actor"] & {
  kind: "agent";
  roleId: string;
  agentBinding: NonNullable<ConversationInboundEvent["actor"]["agentBinding"]>;
};

export interface ConversationPeerTurnRequest {
  taskId: string;
  sourceEvent: ConversationInboundEvent;
  sourceActor: ConversationAgentActor;
  targetParticipantId: string;
  task: string;
  requestedAt: string;
}

export interface ConversationPeerTurnDispatcher {
  dispatch(request: ConversationPeerTurnRequest): Promise<"accepted" | "not_registered">;
}

interface ConversationPeerTurnEndpoint {
  integrationId: string;
  projectId: string;
  participantId: string;
  conversationIds: readonly string[];
  acceptedPeers: readonly DiscordPeerAgentBinding[];
  artifacts: ArtifactStore;
  handle(
    event: ConversationInboundEvent,
  ): Promise<readonly { result: HandleConversationEventResult }[]>;
  deliver(): Promise<void>;
}

function sameAgent(actor: ConversationAgentActor, peer: DiscordPeerAgentBinding): boolean {
  return (
    actor.participantId === peer.participantId &&
    actor.roleId === peer.roleId &&
    actor.agentBinding?.agentId === peer.agentBinding.agentId &&
    actor.agentBinding.roleVersion === peer.agentBinding.roleVersion &&
    actor.agentBinding.roleContractHash === peer.agentBinding.roleContractHash &&
    actor.agentBinding.roleProfileHash === peer.agentBinding.roleProfileHash
  );
}

function assertRequest(request: ConversationPeerTurnRequest): void {
  if (
    request.sourceEvent.actor.kind === "system" ||
    request.task.trim().length === 0 ||
    request.task.length > 1_024 ||
    request.task.includes("\0") ||
    !/^tsk_[A-Za-z0-9_-]{20}$/u.test(request.taskId) ||
    !Number.isFinite(Date.parse(request.requestedAt)) ||
    request.sourceEvent.automationDepth >= maximumAutomationDepth
  ) {
    throw new Error(
      "The peer conversation turn request is invalid or exceeds its automation bound.",
    );
  }
}

/**
 * Routes one addressed turn between independently composed co-resident conversation runtimes.
 * The receiver owns its artifact, interaction lifecycle, provider session, and publication.
 */
export class CoResidentConversationPeerTurnRouter implements ConversationPeerTurnDispatcher {
  private readonly endpoints = new Map<string, ConversationPeerTurnEndpoint>();

  register(endpoint: ConversationPeerTurnEndpoint): () => void {
    if (this.endpoints.has(endpoint.participantId)) {
      throw new Error("A co-resident conversation participant endpoint is duplicated.");
    }
    this.endpoints.set(endpoint.participantId, endpoint);
    return () => {
      if (this.endpoints.get(endpoint.participantId) === endpoint) {
        this.endpoints.delete(endpoint.participantId);
      }
    };
  }

  async dispatch(request: ConversationPeerTurnRequest): Promise<"accepted" | "not_registered"> {
    assertRequest(request);
    const target = this.endpoints.get(request.targetParticipantId);
    if (target === undefined) return "not_registered";
    if (
      target.projectId !== request.sourceEvent.target.projectId ||
      !target.conversationIds.includes(request.sourceEvent.target.conversationId)
    )
      throw new Error("The addressed peer conversation runtime scope differs.");
    const source = target.acceptedPeers.filter(
      (peer) =>
        peer.conversationIds.includes(request.sourceEvent.target.conversationId) &&
        sameAgent(request.sourceActor, peer),
    );
    if (source.length !== 1) {
      throw new Error("The peer conversation source is not bound exactly once at the receiver.");
    }
    const stored = await target.artifacts.put(request.task);
    const event = createConversationInboundEvent({
      sourceEventKeyHash: hashConversationSourceEventKey(
        `peer-turn:${request.sourceEvent.eventId}:${request.sourceActor.participantId}:${target.participantId}`,
      ),
      target: {
        integrationId: target.integrationId,
        projectId: target.projectId,
        conversationId: request.sourceEvent.target.conversationId,
        threadId: request.sourceEvent.target.threadId,
      },
      kind: "message.created",
      actor: request.sourceActor,
      content: {
        artifactId: `art_${stored.contentHash.slice("sha256:".length, 60)}`,
        contentHash: stored.contentHash,
        byteCount: stored.byteCount,
        mediaType: "text/plain; charset=utf-8",
      },
      mentions: { roleIds: [], participantIds: [target.participantId] },
      coordination: {
        kind: "task.assignment",
        taskId: request.taskId,
        coordinatorParticipantId: request.sourceActor.participantId,
      },
      replyToEventId: null,
      signalCode: null,
      automationDepth: request.sourceEvent.automationDepth + 1,
      occurredAt: request.requestedAt,
    });
    const results = await target.handle(event);
    await target.deliver();
    const taskResult = results
      .map((item) => ("outbound" in item.result ? item.result.outbound : null))
      .find(
        (outbound) =>
          outbound?.coordination?.kind === "task.result" &&
          outbound.coordination.taskId === request.taskId,
      );
    if (taskResult !== undefined && taskResult !== null) {
      await this.returnResult(request, target, taskResult);
    }
    return "accepted";
  }

  private async returnResult(
    request: ConversationPeerTurnRequest,
    target: ConversationPeerTurnEndpoint,
    result: ConversationOutboundMessage,
  ): Promise<void> {
    const source = this.endpoints.get(request.sourceActor.participantId);
    if (
      source === undefined ||
      source.projectId !== target.projectId ||
      !source.conversationIds.includes(request.sourceEvent.target.conversationId) ||
      !source.acceptedPeers.some(
        (peer) =>
          peer.participantId === result.actor.participantId &&
          peer.roleId === result.actor.roleId &&
          peer.agentBinding.agentId === result.actor.agentBinding?.agentId,
      )
    ) {
      throw new Error("The delegated result coordinator or returning peer is not bound exactly.");
    }
    const bytes = await target.artifacts.get(
      `lervo-cas://sha256/${result.content.contentHash.slice("sha256:".length)}`,
    );
    const stored = await source.artifacts.put(bytes);
    const event = createConversationInboundEvent({
      sourceEventKeyHash: hashConversationSourceEventKey(
        `peer-result:${request.taskId}:${result.outboundId}`,
      ),
      target: {
        integrationId: source.integrationId,
        projectId: source.projectId,
        conversationId: request.sourceEvent.target.conversationId,
        threadId: request.sourceEvent.target.threadId,
      },
      kind: "message.created",
      actor: result.actor,
      content: {
        artifactId: `art_${stored.contentHash.slice("sha256:".length, 60)}`,
        contentHash: stored.contentHash,
        byteCount: stored.byteCount,
        mediaType: result.content.mediaType,
      },
      coordination: result.coordination!,
      mentions: { roleIds: [], participantIds: [request.sourceActor.participantId] },
      replyToEventId: request.sourceEvent.eventId,
      signalCode: null,
      automationDepth: result.automationDepth,
      occurredAt: result.createdAt,
    });
    await source.handle(event);
    await source.deliver();
  }
}

export function registerConversationPeerTurnEndpoint(input: {
  router: CoResidentConversationPeerTurnRouter;
  integrationId: string;
  projectId: string;
  participantId: string;
  conversationIds: readonly string[];
  acceptedPeers: readonly DiscordPeerAgentBinding[];
  artifacts: ArtifactStore;
  handle(
    event: ConversationInboundEvent,
  ): Promise<readonly { result: HandleConversationEventResult }[]>;
  deliver(): Promise<void>;
}): () => void {
  return input.router.register(input);
}
