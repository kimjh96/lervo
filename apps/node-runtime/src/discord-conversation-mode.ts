import {
  parseConversationControlCommand,
  readConversationControlMessage,
} from "@lervo/conversation-control";
import type { ConversationReplyCandidate, ConversationResponder } from "@lervo/interaction";
import type { ConversationRelevanceEvaluator } from "@lervo/interaction";
import type {
  ManagedConversationSurfaceEffect,
  ManagedConversationTurnResolverPort,
} from "@lervo/conversation-responder";
import { readCurrentWorkstream } from "@lervo/repository-knowledge/workstream";
import type { ConversationInboundEvent } from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";

import type {
  ConversationIntentResolution,
  ConversationIntentResolver,
  ConversationRequestedEffect,
} from "./conversation-intent-resolver.js";
import type { ConversationHistoryPort } from "./conversation-history.js";
import type { ConversationOwnerTurnCapturePort } from "./conversation-owner-turn-capture.js";
import type { ConversationIntentResolutionStore } from "./conversation-intent-store.js";
import type {
  ConversationDiscussionDirective,
  ConversationDiscussionRuntime,
} from "./conversation-discussion-runtime.js";
import { respondToConversationDiscussion } from "./conversation-discussion-response.js";
import {
  admittedConversationMode,
  type AuthorizedAgentEffectRequester,
  isConversationEffectRequesterAuthorized,
} from "./discord-conversation-effect-authorization.js";
import {
  effectForManagedConversationResolution,
  withoutLeadingBotMention,
} from "./discord-conversation-mode-selection.js";
import {
  availableDiscussionIntentEffects,
  availableDiscussionSurfaceEffects,
} from "./conversation-discussion-availability.js";
import type {
  DiscordGoalResponder,
  DiscordNonPlatformEffect,
  DiscordPlatformActionResponder,
} from "./discord-conversation-mode-contract.js";

export type {
  DiscordGoalResponder,
  DiscordPlatformActionResponder,
} from "./discord-conversation-mode-contract.js";

export type DiscordConversationMode =
  "read_only" | "work" | "goal" | "continuation" | "platform_action" | "clarify" | "control";

export class NaturalLanguageDiscordConversationResponder
  implements ConversationResponder, ConversationRelevanceEvaluator
{
  private readonly resolutions = new Map<
    string,
    Promise<{
      mode: DiscordConversationMode;
      resolution: ConversationIntentResolution;
      priorTurns: Awaited<ReturnType<ConversationHistoryPort["recent"]>>;
      replyCandidate: ConversationReplyCandidate | null;
    }>
  >();
  private readonly discussionDirectives = new Map<
    string,
    Promise<ConversationDiscussionDirective>
  >();

  constructor(
    private readonly options: {
      applicationId: string;
      respondingAgent: { participantId: string; agentId: string | null; roleId: string };
      authorizedAgentEffectRequesters?: readonly AuthorizedAgentEffectRequester[];
      repositoryRoot: string;
      artifactStore: ArtifactStore;
      history: ConversationHistoryPort;
      resolutionStore: ConversationIntentResolutionStore;
      intentResolver?: ConversationIntentResolver;
      managedTurnResolver?: ManagedConversationTurnResolverPort;
      surfaceEffects?: readonly ManagedConversationSurfaceEffect[];
      discussionEligibleConversationIds?: readonly string[];
      availableEffects?: readonly ConversationRequestedEffect["kind"][];
      participationPolicy: Parameters<ConversationRelevanceEvaluator["evaluate"]>[0]["policy"];
      readOnly: ConversationResponder;
      continuation: ConversationResponder;
      work?: ConversationResponder;
      goal?: DiscordGoalResponder;
      platformAction: DiscordPlatformActionResponder;
      explicitControl?: ConversationResponder;
      discussion?: ConversationDiscussionRuntime;
      ownerTurnCapture?: ConversationOwnerTurnCapturePort;
    },
  ) {}

  private admittedMode(
    event: ConversationInboundEvent,
    resolution: ConversationIntentResolution,
  ): DiscordConversationMode {
    return admittedConversationMode({
      event,
      resolution,
      ...(this.options.authorizedAgentEffectRequesters === undefined
        ? {}
        : { requesters: this.options.authorizedAgentEffectRequesters }),
      goalAvailable: this.options.goal !== undefined,
    });
  }

  async mode(event: ConversationInboundEvent): Promise<DiscordConversationMode> {
    return (await this.resolution(event)).mode;
  }

  async usesFixedDiscussionPublicationContract(event: ConversationInboundEvent): Promise<boolean> {
    const directive = await this.discussionDirective(event);
    return directive.kind === "next_assignment" || directive.kind === "failure";
  }

  async usesManagedActionResultPublicationContract(
    event: ConversationInboundEvent,
  ): Promise<boolean> {
    const resolved = await this.resolution(event);
    return (
      resolved.mode === "platform_action" &&
      (this.options.platformAction.managedResultEffects?.includes(
        resolved.resolution.effect.kind,
      ) ??
        false)
    );
  }

  private resolution(event: ConversationInboundEvent) {
    const existing = this.resolutions.get(event.eventId);
    if (existing !== undefined) return existing;
    const resolution = this.resolveMode(event);
    if (this.resolutions.size >= 1_024) {
      this.resolutions.delete(this.resolutions.keys().next().value!);
    }
    this.resolutions.set(event.eventId, resolution);
    return resolution;
  }

  private async resolveMode(event: ConversationInboundEvent): Promise<{
    mode: DiscordConversationMode;
    resolution: ConversationIntentResolution;
    priorTurns: Awaited<ReturnType<ConversationHistoryPort["recent"]>>;
    replyCandidate: ConversationReplyCandidate | null;
  }> {
    const discussion = await this.discussionDirective(event);
    if (discussion.kind !== "none") {
      const resolution: ConversationIntentResolution = {
        intent: "answer",
        confidence: "high",
        participation: "relevant",
        effect: { kind: "none" },
        executionProfile: null,
        provider: { providerId: "lervo_discussion", model: null, adapterVersion: "1" },
        resultDigest: event.content.contentHash,
      };
      await this.options.resolutionStore.record({
        event,
        resolution,
        resolvedAt: new Date().toISOString(),
      });
      return {
        mode: "read_only",
        resolution,
        priorTurns: discussion.kind === "decision" ? discussion.priorTurns : [],
        replyCandidate: null,
      };
    }
    if (event.coordination?.kind.startsWith("discussion.") === true) {
      const resolution: ConversationIntentResolution = {
        intent: "answer",
        confidence: "high",
        participation: "not_relevant",
        effect: { kind: "none" },
        executionProfile: null,
        provider: { providerId: "lervo_discussion", model: null, adapterVersion: "1" },
        resultDigest: event.content.contentHash,
      };
      await this.options.resolutionStore.record({
        event,
        resolution,
        resolvedAt: new Date().toISOString(),
      });
      return {
        mode: "read_only",
        resolution,
        priorTurns: [],
        replyCandidate: null,
      };
    }
    if (event.kind === "goal.requested") {
      const resolution: ConversationIntentResolution = {
        intent: "continue_work",
        confidence: "high",
        participation: "relevant",
        effect: { kind: "supervision_goal_request" },
        executionProfile: null,
        provider: { providerId: "lervo_goal", model: null, adapterVersion: "1" },
        resultDigest: event.content.contentHash,
      };
      await this.options.resolutionStore.record({
        event,
        resolution,
        resolvedAt: new Date().toISOString(),
      });
      return {
        mode: this.admittedMode(event, resolution),
        resolution,
        priorTurns: [],
        replyCandidate: null,
      };
    }
    if (this.options.explicitControl !== undefined) {
      const message = withoutLeadingBotMention(
        await readConversationControlMessage({ artifactStore: this.options.artifactStore, event }),
        this.options.applicationId,
      );
      const control = parseConversationControlCommand(message);
      if (control !== null && !("deliveryId" in control)) {
        return {
          mode: "control",
          resolution: {
            intent: "answer",
            confidence: "high",
            participation: "relevant",
            effect: { kind: "none" },
            executionProfile: null,
            provider: { providerId: "lervo_control", model: null, adapterVersion: "2" },
            resultDigest: event.content.contentHash,
          },
          priorTurns: [],
          replyCandidate: null,
        };
      }
    }
    const priorTurns = await this.options.history.recent(event);
    await this.options.ownerTurnCapture?.capture({
      event,
      priorTurns,
      respondingAgentId: this.options.respondingAgent.agentId,
    });
    const respondingAgentMentioned =
      event.mentions.participantIds.includes(this.options.respondingAgent.participantId) ||
      event.mentions.roleIds.includes(this.options.respondingAgent.roleId);
    const discussionAvailable =
      this.options.discussionEligibleConversationIds?.includes(event.target.conversationId) ?? true;
    const surfaceEffects = availableDiscussionSurfaceEffects(
      this.options.surfaceEffects ?? [],
      discussionAvailable,
    );
    const availableEffects = availableDiscussionIntentEffects(
      this.options.availableEffects ?? this.options.platformAction.availableEffects,
      discussionAvailable,
    );
    if (this.options.managedTurnResolver !== undefined) {
      const managed = await this.options.managedTurnResolver.resolve({
        event,
        policy: this.options.participationPolicy,
        respondingAgent: this.options.respondingAgent,
        mentioned: respondingAgentMentioned,
        surfaceEffects,
        context: { priorTurns },
      });
      const effect = effectForManagedConversationResolution(managed.effect);
      const resolution: ConversationIntentResolution = {
        intent: managed.intent,
        confidence: managed.confidence,
        participation: managed.participation,
        effect,
        executionProfile: managed.executionProfile,
        provider: managed.provider,
        resultDigest: managed.resultDigest,
      };
      await this.options.resolutionStore.record({
        event,
        resolution,
        resolvedAt: new Date().toISOString(),
      });
      return {
        mode: this.admittedMode(event, resolution),
        resolution,
        priorTurns,
        replyCandidate: managed.replyCandidate,
      };
    }
    const stored = await this.options.resolutionStore.read(event);
    if (stored !== null) {
      return {
        mode: this.admittedMode(event, stored),
        resolution: stored,
        priorTurns,
        replyCandidate: null,
      };
    }
    const message = withoutLeadingBotMention(
      await readConversationControlMessage({ artifactStore: this.options.artifactStore, event }),
      this.options.applicationId,
    );
    const current = await readCurrentWorkstream(this.options.repositoryRoot);
    if (this.options.intentResolver === undefined) {
      throw new TypeError("No managed or legacy conversation turn resolver is configured.");
    }
    const resolution = await this.options.intentResolver.resolve({
      message,
      actorKind: event.actor.kind,
      mentioned: respondingAgentMentioned,
      respondingAgent: this.options.respondingAgent,
      priorTurns,
      currentWorkstream:
        current === null
          ? null
          : { title: current.title, objective: current.objective, status: current.status },
      availableEffects,
    });
    await this.options.resolutionStore.record({
      event,
      resolution,
      resolvedAt: new Date().toISOString(),
    });
    return {
      mode: this.admittedMode(event, resolution),
      resolution,
      priorTurns,
      replyCandidate: null,
    };
  }

  async respond(input: Parameters<ConversationResponder["respond"]>[0]) {
    const resolution = await this.resolution(input.event);
    const discussion = await this.discussionDirective(input.event);
    const request = {
      ...input,
      context: {
        priorTurns: resolution.priorTurns,
        ...((discussion.kind === "assignment" || discussion.kind === "decision"
          ? discussion.executionProfile
          : resolution.resolution.executionProfile) === null ||
        (discussion.kind === "assignment" || discussion.kind === "decision"
          ? discussion.executionProfile
          : resolution.resolution.executionProfile) === undefined
          ? {}
          : {
              executionProfile:
                discussion.kind === "assignment" || discussion.kind === "decision"
                  ? discussion.executionProfile
                  : resolution.resolution.executionProfile!,
            }),
      },
    };
    const discussionCandidate = await respondToConversationDiscussion({
      directive: discussion,
      request,
      readOnly: this.options.readOnly,
      discussion: this.options.discussion,
      artifactStore: this.options.artifactStore,
    });
    if (discussionCandidate !== null) return discussionCandidate;
    if (resolution.mode === "control") return this.options.explicitControl!.respond(request);
    if (
      resolution.mode === "platform_action" &&
      !["none", "repository_work", "supervision_goal_request"].includes(
        resolution.resolution.effect.kind,
      )
    ) {
      return this.options.platformAction.respond(
        request,
        resolution.resolution.effect as Exclude<
          ConversationRequestedEffect,
          DiscordNonPlatformEffect
        >,
        {
          effectRequesterAuthorized: isConversationEffectRequesterAuthorized({
            event: input.event,
            effectKind: resolution.resolution.effect.kind,
            ...(this.options.authorizedAgentEffectRequesters === undefined
              ? {}
              : { requesters: this.options.authorizedAgentEffectRequesters }),
          }),
        },
      );
    }
    if (["read_only", "clarify"].includes(resolution.mode) && resolution.replyCandidate !== null) {
      return resolution.replyCandidate;
    }
    if (resolution.mode === "work") {
      return (this.options.work ?? this.options.continuation).respond(request);
    }
    if (resolution.mode === "goal")
      return this.options.goal!.respond(request, resolution.replyCandidate);
    return (
      resolution.mode === "continuation" ? this.options.continuation : this.options.readOnly
    ).respond(request);
  }

  async evaluate(input: Parameters<ConversationRelevanceEvaluator["evaluate"]>[0]) {
    return (await this.resolution(input.event)).resolution.participation;
  }

  private discussionDirective(event: ConversationInboundEvent) {
    const existing = this.discussionDirectives.get(event.eventId);
    if (existing !== undefined) return existing;
    const directive =
      this.options.discussion?.directive(event) ??
      Promise.resolve({ kind: "none" } as const satisfies ConversationDiscussionDirective);
    if (this.discussionDirectives.size >= 1_024) {
      this.discussionDirectives.delete(this.discussionDirectives.keys().next().value!);
    }
    this.discussionDirectives.set(event.eventId, directive);
    return directive;
  }
}
