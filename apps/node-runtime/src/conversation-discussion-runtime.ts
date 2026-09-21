import type { ConversationContextTurn } from "@lervo/conversation-responder";
import type { ConversationAgentBinding, ConversationInboundEvent } from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";

import {
  createConversationDiscussionAssignment,
  exactDiscussionPeer,
  renderConversationDiscussionAssignment,
  selectConversationDiscussionParticipants,
  type ConversationDiscussionAssignmentEnvelope,
  type ConversationDiscussionParticipant,
} from "./conversation-discussion-protocol.js";
import {
  buildConversationDiscussionDecisionContext,
  conversationContentReference,
  conversationDiscussionIdempotencyKey,
  conversationDiscussionTurnId,
  sameConversationAgentBinding,
} from "./conversation-discussion-evidence.js";
import { createNextConversationDiscussionAssignment } from "./conversation-discussion-next-assignment.js";
import { ownsConversationDiscussionTurn } from "./conversation-discussion-ownership.js";
import {
  acceptConversationDiscussionDeadline,
  createConversationDiscussionDeadlineEvents,
} from "./conversation-discussion-deadline.js";
import { SQLiteConversationDiscussionStore } from "./conversation-discussion-store.js";
import type { DiscordPeerAgentBinding } from "./discord-conversation-composition.js";

export type ConversationDiscussionDirective =
  | { kind: "none" }
  | { kind: "assignment"; discussionId: string; executionProfile: "review" }
  | {
      kind: "next_assignment";
      discussionId: string;
      activeParticipantId: string;
      content: string;
    }
  | {
      kind: "decision";
      discussionId: string;
      executionProfile: "reasoning";
      priorTurns: ConversationContextTurn[];
      terminalState: "converged" | "failed";
    }
  | {
      kind: "failure";
      discussionId: string;
      content: string;
    };

export class ConversationDiscussionRuntime {
  private constructor(
    private readonly options: {
      integrationId: string;
      participantId: string;
      roleId: string;
      agentBinding: ConversationAgentBinding | null;
      peers: readonly DiscordPeerAgentBinding[];
      artifacts: ArtifactStore;
      store: SQLiteConversationDiscussionStore;
      now: () => Date;
    },
  ) {}

  static async open(input: {
    path: string;
    integrationId: string;
    participantId: string;
    roleId: string;
    agentBinding?: ConversationAgentBinding;
    peers: readonly DiscordPeerAgentBinding[];
    artifacts: ArtifactStore;
    now?: () => Date;
  }): Promise<ConversationDiscussionRuntime> {
    return new ConversationDiscussionRuntime({
      integrationId: input.integrationId,
      participantId: input.participantId,
      roleId: input.roleId,
      agentBinding: input.agentBinding ?? null,
      peers: input.peers,
      artifacts: input.artifacts,
      store: await SQLiteConversationDiscussionStore.open(input.path),
      now: input.now ?? (() => new Date()),
    });
  }

  async start(input: {
    event: ConversationInboundEvent;
    topic: string;
    language: "ko" | "en";
  }): Promise<
    | {
        status: "started";
        discussionId: string;
        content: string;
        participantIds: string[];
      }
    | { status: "insufficient_participants"; participantCount: number }
  > {
    if (this.options.agentBinding === null) {
      return { status: "insufficient_participants", participantCount: 0 };
    }
    const participants = selectConversationDiscussionParticipants({
      sourceEventId: input.event.sourceEventKeyHash,
      conversationId: input.event.target.conversationId,
      peers: this.options.peers,
    });
    if (participants.length < 2) {
      return { status: "insufficient_participants", participantCount: participants.length };
    }
    const content = renderConversationDiscussionAssignment({
      participants,
      topic: input.topic,
      language: input.language,
    });
    const [topicStored, assignmentStored] = await Promise.all([
      this.options.artifacts.put(input.topic),
      this.options.artifacts.put(content),
    ]);
    const requestedAt = this.options.now().toISOString();
    const envelope = createConversationDiscussionAssignment({
      event: input.event,
      source: {
        participantId: this.options.participantId,
        roleId: this.options.roleId,
        agentBinding: this.options.agentBinding,
      },
      targets: participants,
      taskContentHash: assignmentStored.contentHash,
      requestedAt,
    });
    this.options.store.start({
      envelope,
      topic: conversationContentReference(topicStored),
      originEventId: input.event.eventId,
      requestedAt,
    });
    return {
      status: "started",
      discussionId: envelope.discussionId,
      content,
      participantIds: participants.map((participant) => participant.participantId),
    };
  }

  ownsCoordinationTurn(event: ConversationInboundEvent): boolean | null {
    return ownsConversationDiscussionTurn({
      event,
      participantId: this.options.participantId,
      agentBinding: this.options.agentBinding,
      peers: this.options.peers,
      discussion:
        event.coordination?.kind === "discussion.contribution" ||
        event.coordination?.kind === "discussion.decision"
          ? this.options.store.get(event.coordination.discussionId)
          : null,
    });
  }

  async directive(event: ConversationInboundEvent): Promise<ConversationDiscussionDirective> {
    if (event.coordination === undefined) return { kind: "none" };
    if (event.coordination.kind === "discussion.assignment") {
      return this.acceptAssignment(event);
    }
    if (event.coordination.kind === "discussion.contribution") {
      return this.acceptContribution(event);
    }
    if (
      event.coordination.kind === "discussion.decision" &&
      event.kind === "signal.raised" &&
      event.signalCode === "discussion.deadline"
    ) {
      return acceptConversationDiscussionDeadline({
        event,
        participantId: this.options.participantId,
        store: this.options.store,
        artifacts: this.options.artifacts,
      });
    }
    return { kind: "none" };
  }

  private async acceptAssignment(
    event: ConversationInboundEvent,
  ): Promise<ConversationDiscussionDirective> {
    const coordination = event.coordination;
    if (coordination?.kind !== "discussion.assignment") return { kind: "none" };
    const source = exactDiscussionPeer({ event, peers: this.options.peers });
    if (
      source === null ||
      this.options.agentBinding === null ||
      coordination.activeParticipantId !== this.options.participantId ||
      !event.mentions.participantIds.includes(this.options.participantId) ||
      event.automationDepth > 6
    ) {
      return { kind: "none" };
    }
    const targets = this.assignmentTargets(event);
    if (targets.length !== 2) {
      this.options.store.recordProtocolState({
        discussionId: coordination.discussionId,
        state: "discussion.turn.rejected",
        turnId: event.eventId,
        participantId: this.options.participantId,
        reasonCode: "participant_binding_invalid",
        occurredAt: event.occurredAt,
      });
      return { kind: "none" };
    }
    const envelope: ConversationDiscussionAssignmentEnvelope = {
      schemaVersion: 1,
      discussionId: coordination.discussionId,
      turnId: conversationDiscussionTurnId(coordination.discussionId, "assignment"),
      parentTurnId: null,
      source: {
        participantId: source.participantId,
        roleId: source.roleId,
        agentBinding: structuredClone(source.agentBinding),
      },
      targets: targets.map(({ participantId, roleId, agentBinding }) => ({
        participantId,
        roleId,
        agentBinding: structuredClone(agentBinding),
      })),
      conversation: {
        projectId: event.target.projectId,
        conversationId: event.target.conversationId,
        threadId: event.target.threadId,
      },
      taskDigest: event.content.contentHash,
      sharedContextDigest: event.content.contentHash,
      deadlineAt: new Date(Date.parse(event.occurredAt) + 5 * 60_000).toISOString(),
      automationDepth: event.automationDepth,
      executionProfile: "review",
      idempotencyKey: conversationDiscussionIdempotencyKey(coordination.discussionId),
    };
    this.options.store.start({
      envelope,
      topic: event.content,
      originEventId: event.eventId,
      requestedAt: event.occurredAt,
      recordRequested: false,
    });
    this.options.store.recordProtocolState({
      discussionId: envelope.discussionId,
      state: "discussion.participant.accepted",
      turnId: envelope.turnId,
      participantId: this.options.participantId,
      reasonCode: null,
      occurredAt: event.occurredAt,
    });
    return {
      kind: "assignment",
      discussionId: envelope.discussionId,
      executionProfile: "review",
    };
  }

  private assignmentTargets(event: ConversationInboundEvent): ConversationDiscussionParticipant[] {
    return [...new Set(event.mentions.participantIds)].flatMap((participantId) => {
      if (participantId === this.options.participantId && this.options.agentBinding !== null) {
        return [
          {
            participantId,
            roleId: this.options.roleId,
            displayName: null,
            applicationId: "0",
            agentBinding: structuredClone(this.options.agentBinding),
          },
        ];
      }
      const matches = this.options.peers.filter(
        (peer) =>
          peer.participantId === participantId &&
          peer.conversationIds.includes(event.target.conversationId),
      );
      if (matches.length > 1) throw new Error("A discussion target has duplicate peer bindings.");
      const peer = matches[0];
      return peer === undefined
        ? []
        : [
            {
              participantId: peer.participantId,
              roleId: peer.roleId,
              displayName: peer.displayName ?? null,
              applicationId: "0",
              agentBinding: structuredClone(peer.agentBinding),
            },
          ];
    });
  }

  private async acceptContribution(
    event: ConversationInboundEvent,
  ): Promise<ConversationDiscussionDirective> {
    const coordination = event.coordination;
    if (coordination?.kind !== "discussion.contribution") return { kind: "none" };
    const peer = exactDiscussionPeer({ event, peers: this.options.peers });
    const discussion = this.options.store.get(coordination.discussionId);
    if (
      peer === null ||
      discussion === null ||
      this.options.agentBinding === null ||
      discussion.envelope.source.participantId !== this.options.participantId ||
      !sameConversationAgentBinding(
        discussion.envelope.source.agentBinding,
        this.options.agentBinding,
      ) ||
      event.replyToEventId !== discussion.originEventId
    ) {
      return { kind: "none" };
    }
    const recorded = this.options.store.recordContribution({
      discussionId: coordination.discussionId,
      contribution: {
        participantId: peer.participantId,
        roleId: peer.roleId,
        agentBinding: structuredClone(peer.agentBinding),
        eventId: event.eventId,
        content: structuredClone(event.content),
        occurredAt: event.occurredAt,
      },
    });
    if (!recorded.complete || recorded.discussion.decisionEventId !== event.eventId) {
      const next = await createNextConversationDiscussionAssignment({
        discussion: recorded.discussion,
        peers: this.options.peers,
        artifacts: this.options.artifacts,
        store: this.options.store,
      });
      return {
        kind: "next_assignment",
        discussionId: coordination.discussionId,
        activeParticipantId: next.activeParticipantId,
        content: next.content,
      };
    }
    return {
      kind: "decision",
      discussionId: coordination.discussionId,
      executionProfile: "reasoning",
      priorTurns: await buildConversationDiscussionDecisionContext({
        artifacts: this.options.artifacts,
        store: this.options.store,
        discussion: recorded.discussion,
        currentEventId: event.eventId,
      }),
      terminalState: "converged",
    };
  }

  deadlineEvents(at = this.options.now().toISOString()): ConversationInboundEvent[] {
    return createConversationDiscussionDeadlineEvents({
      integrationId: this.options.integrationId,
      participantId: this.options.participantId,
      store: this.options.store,
      at,
    });
  }

  nextDeadlineAt(): number | null {
    return this.options.store.nextDeadlineAt(this.options.participantId);
  }

  markConverged(input: { discussionId: string; eventId: string; occurredAt: string }): void {
    this.options.store.recordProtocolState({
      discussionId: input.discussionId,
      state: "discussion.converged",
      turnId: input.eventId,
      participantId: this.options.participantId,
      reasonCode: null,
      occurredAt: input.occurredAt,
    });
  }

  markFailed(input: { discussionId: string; eventId: string; occurredAt: string }): void {
    this.options.store.recordProtocolState({
      discussionId: input.discussionId,
      state: "discussion.failed",
      turnId: input.eventId,
      participantId: this.options.participantId,
      reasonCode: "participant_deadline_exceeded",
      occurredAt: input.occurredAt,
    });
  }

  close(): void {
    this.options.store.close();
  }
}
