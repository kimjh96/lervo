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
import type { ConversationIntentResolutionStore } from "./conversation-intent-store.js";

export type DiscordConversationMode =
  "read_only" | "work" | "continuation" | "platform_action" | "clarify" | "control";

export interface DiscordPlatformActionResponder {
  readonly availableEffects: readonly ConversationRequestedEffect["kind"][];
  respond(
    input: Parameters<ConversationResponder["respond"]>[0],
    effect: Exclude<ConversationRequestedEffect, { kind: "none" | "repository_work" }>,
    authorization: { effectRequesterAuthorized: boolean },
  ): ReturnType<ConversationResponder["respond"]>;
}

function withoutLeadingBotMention(message: string, applicationId: string): string {
  return message
    .trimStart()
    .replace(new RegExp(`^<@!?${applicationId}>\\s*`, "u"), "")
    .trimStart();
}

function modeFor(resolution: ConversationIntentResolution): DiscordConversationMode {
  return resolution.intent === "continue_work" && resolution.confidence !== "low"
    ? resolution.effect.kind === "repository_work"
      ? "work"
      : "platform_action"
    : resolution.intent === "clarify" || resolution.confidence === "low"
      ? "clarify"
      : "read_only";
}

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

  constructor(
    private readonly options: {
      applicationId: string;
      respondingAgent: { agentId: string | null; roleId: string };
      authorizedAgentEffectRequesters?: readonly {
        participantId: string;
        roleId: string;
        conversationId: string;
      }[];
      repositoryRoot: string;
      artifactStore: ArtifactStore;
      history: ConversationHistoryPort;
      resolutionStore: ConversationIntentResolutionStore;
      intentResolver?: ConversationIntentResolver;
      managedTurnResolver?: ManagedConversationTurnResolverPort;
      surfaceEffects?: readonly ManagedConversationSurfaceEffect[];
      participationPolicy: Parameters<ConversationRelevanceEvaluator["evaluate"]>[0]["policy"];
      readOnly: ConversationResponder;
      continuation: ConversationResponder;
      work?: ConversationResponder;
      platformAction: DiscordPlatformActionResponder;
      explicitControl?: ConversationResponder;
    },
  ) {}

  private admittedMode(
    event: ConversationInboundEvent,
    resolution: ConversationIntentResolution,
  ): DiscordConversationMode {
    const mode = modeFor(resolution);
    if (
      !["work", "continuation", "platform_action"].includes(mode) ||
      event.actor.kind === "human"
    ) {
      return mode;
    }
    const admitted = this.options.authorizedAgentEffectRequesters?.some(
      (requester) =>
        requester.participantId === event.actor.participantId &&
        requester.roleId === event.actor.roleId &&
        requester.conversationId === event.target.conversationId,
    );
    return admitted === true ? mode : "clarify";
  }

  private effectRequesterAuthorized(event: ConversationInboundEvent): boolean {
    return (
      event.actor.kind === "human" ||
      this.options.authorizedAgentEffectRequesters?.some(
        (requester) =>
          requester.participantId === event.actor.participantId &&
          requester.roleId === event.actor.roleId &&
          requester.conversationId === event.target.conversationId,
      ) === true
    );
  }

  async mode(event: ConversationInboundEvent): Promise<DiscordConversationMode> {
    return (await this.resolution(event)).mode;
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
    if (event.kind === "goal.requested") {
      const resolution: ConversationIntentResolution = {
        intent: "continue_work",
        confidence: "high",
        participation: "relevant",
        effect: { kind: "repository_work" },
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
            provider: { providerId: "lervo_control", model: null, adapterVersion: "2" },
            resultDigest: event.content.contentHash,
          },
          priorTurns: [],
          replyCandidate: null,
        };
      }
    }
    const priorTurns = await this.options.history.recent(event);
    if (this.options.managedTurnResolver !== undefined) {
      const managed = await this.options.managedTurnResolver.resolve({
        event,
        policy: this.options.participationPolicy,
        respondingAgent: this.options.respondingAgent,
        mentioned: event.mentions.participantIds.length > 0 || event.mentions.roleIds.length > 0,
        surfaceEffects: this.options.surfaceEffects ?? [],
        context: { priorTurns },
      });
      const effect: ConversationRequestedEffect =
        managed.effect.kind === "discord_current_member_nickname_set"
          ? {
              kind: "discord_current_member_nickname_set",
              nickname: managed.effect.argument!,
            }
          : managed.effect.kind === "discord_guild_text_channel_create" ||
              managed.effect.kind === "discord_public_thread_create"
            ? { kind: managed.effect.kind, name: managed.effect.argument! }
            : managed.effect.kind === "workforce_agent_hire"
              ? { kind: managed.effect.kind, specification: managed.effect.argument! }
              : managed.effect.kind === "repository_work"
                ? { kind: "repository_work" }
                : { kind: "none" };
      const resolution: ConversationIntentResolution = {
        intent: managed.intent,
        confidence: managed.confidence,
        participation: managed.participation,
        effect,
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
      mentioned: event.mentions.participantIds.length > 0 || event.mentions.roleIds.length > 0,
      respondingAgent: this.options.respondingAgent,
      priorTurns,
      currentWorkstream:
        current === null
          ? null
          : { title: current.title, objective: current.objective, status: current.status },
      availableEffects: this.options.platformAction.availableEffects,
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
    const request = { ...input, context: { priorTurns: resolution.priorTurns } };
    if (resolution.mode === "control") return this.options.explicitControl!.respond(request);
    if (
      resolution.mode === "platform_action" &&
      !["none", "repository_work"].includes(resolution.resolution.effect.kind)
    ) {
      return this.options.platformAction.respond(
        request,
        resolution.resolution.effect as Exclude<
          ConversationRequestedEffect,
          { kind: "none" | "repository_work" }
        >,
        { effectRequesterAuthorized: this.effectRequesterAuthorized(input.event) },
      );
    }
    if (["read_only", "clarify"].includes(resolution.mode) && resolution.replyCandidate !== null) {
      return resolution.replyCandidate;
    }
    if (resolution.mode === "work") {
      return (this.options.work ?? this.options.continuation).respond(request);
    }
    return (
      resolution.mode === "continuation" ? this.options.continuation : this.options.readOnly
    ).respond(request);
  }

  async evaluate(input: Parameters<ConversationRelevanceEvaluator["evaluate"]>[0]) {
    return (await this.resolution(input.event)).resolution.participation;
  }
}
