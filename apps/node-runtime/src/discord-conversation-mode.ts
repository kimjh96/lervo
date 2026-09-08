import { readConversationControlMessage } from "@lervo/conversation-control";
import type { ConversationResponder } from "@lervo/interaction";
import type { ConversationRelevanceEvaluator } from "@lervo/interaction";
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

export type DiscordConversationMode = "read_only" | "continuation" | "platform_action" | "clarify";

export interface DiscordPlatformActionResponder {
  readonly availableEffects: readonly ConversationRequestedEffect["kind"][];
  respond(
    input: Parameters<ConversationResponder["respond"]>[0],
    effect: Exclude<ConversationRequestedEffect, { kind: "none" | "repository_work" }>,
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
      ? "continuation"
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
    }>
  >();

  constructor(
    private readonly options: {
      applicationId: string;
      respondingAgent: { agentId: string | null; roleId: string };
      repositoryRoot: string;
      artifactStore: ArtifactStore;
      history: ConversationHistoryPort;
      resolutionStore: ConversationIntentResolutionStore;
      intentResolver: ConversationIntentResolver;
      readOnly: ConversationResponder;
      continuation: ConversationResponder;
      platformAction: DiscordPlatformActionResponder;
    },
  ) {}

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
  }> {
    const priorTurns = await this.options.history.recent(event);
    const stored = await this.options.resolutionStore.read(event);
    if (stored !== null) {
      const storedMode = modeFor(stored);
      return {
        mode:
          ["continuation", "platform_action"].includes(storedMode) && event.actor.kind !== "human"
            ? "clarify"
            : storedMode,
        resolution: stored,
        priorTurns,
      };
    }
    const message = withoutLeadingBotMention(
      await readConversationControlMessage({ artifactStore: this.options.artifactStore, event }),
      this.options.applicationId,
    );
    const current = await readCurrentWorkstream(this.options.repositoryRoot);
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
    const mode = modeFor(resolution);
    return {
      mode:
        ["continuation", "platform_action"].includes(mode) && event.actor.kind !== "human"
          ? "clarify"
          : mode,
      resolution,
      priorTurns,
    };
  }

  async respond(input: Parameters<ConversationResponder["respond"]>[0]) {
    const resolution = await this.resolution(input.event);
    const request = { ...input, context: { priorTurns: resolution.priorTurns } };
    if (
      resolution.mode === "platform_action" &&
      resolution.resolution.effect.kind === "discord_current_member_nickname_set"
    ) {
      return this.options.platformAction.respond(request, resolution.resolution.effect);
    }
    return (
      resolution.mode === "continuation" ? this.options.continuation : this.options.readOnly
    ).respond(request);
  }

  async evaluate(input: Parameters<ConversationRelevanceEvaluator["evaluate"]>[0]) {
    return (await this.resolution(input.event)).resolution.participation;
  }
}
