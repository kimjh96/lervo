import { readConversationControlMessage } from "@lervo/conversation-control";
import type { ConversationResponder } from "@lervo/interaction";
import { readCurrentWorkstream } from "@lervo/repository-knowledge/workstream";
import type { ConversationInboundEvent } from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";

import type {
  ConversationIntentResolution,
  ConversationIntentResolver,
} from "./conversation-intent-resolver.js";
import type { ConversationHistoryPort } from "./conversation-history.js";
import type { ConversationIntentResolutionStore } from "./conversation-intent-store.js";

export type DiscordConversationMode = "read_only" | "continuation" | "clarify";

function withoutLeadingBotMention(message: string, applicationId: string): string {
  return message
    .trimStart()
    .replace(new RegExp(`^<@!?${applicationId}>\\s*`, "u"), "")
    .trimStart();
}

function modeFor(resolution: ConversationIntentResolution): DiscordConversationMode {
  return resolution.intent === "continue_work" && resolution.confidence !== "low"
    ? "continuation"
    : resolution.intent === "clarify" || resolution.confidence === "low"
      ? "clarify"
      : "read_only";
}

export class NaturalLanguageDiscordConversationResponder implements ConversationResponder {
  private readonly resolutions = new Map<
    string,
    Promise<{
      mode: DiscordConversationMode;
      priorTurns: Array<{ role: "user" | "assistant"; text: string }>;
    }>
  >();

  constructor(
    private readonly options: {
      applicationId: string;
      repositoryRoot: string;
      artifactStore: ArtifactStore;
      history: ConversationHistoryPort;
      resolutionStore: ConversationIntentResolutionStore;
      intentResolver: ConversationIntentResolver;
      readOnly: ConversationResponder;
      continuation: ConversationResponder;
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
    priorTurns: Array<{ role: "user" | "assistant"; text: string }>;
  }> {
    const priorTurns = await this.options.history.recent(event);
    const stored = await this.options.resolutionStore.read(event);
    if (stored !== null) {
      const storedMode = modeFor(stored);
      return {
        mode:
          storedMode === "continuation" && event.actor.kind !== "human" ? "clarify" : storedMode,
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
      priorTurns,
      currentWorkstream:
        current === null
          ? null
          : { title: current.title, objective: current.objective, status: current.status },
    });
    await this.options.resolutionStore.record({
      event,
      resolution,
      resolvedAt: new Date().toISOString(),
    });
    const mode = modeFor(resolution);
    return {
      mode: mode === "continuation" && event.actor.kind !== "human" ? "clarify" : mode,
      priorTurns,
    };
  }

  async respond(input: Parameters<ConversationResponder["respond"]>[0]) {
    const resolution = await this.resolution(input.event);
    return (
      resolution.mode === "continuation" ? this.options.continuation : this.options.readOnly
    ).respond({ ...input, context: { priorTurns: resolution.priorTurns } });
  }
}
