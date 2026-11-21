import { constants } from "node:fs";
import { access, lstat } from "node:fs/promises";
import { resolve } from "node:path";

import type {
  ConversationApplication,
  ConversationApplicationOptions,
} from "@lervo/conversation-app";
import {
  ConversationDeliberationResponder,
  type ConversationDeliberationPort,
} from "@lervo/conversation-control";
import type { ManagedConversationSurfaceEffect } from "@lervo/conversation-responder";
import { fixedConversationStatusWritingContract } from "@lervo/core";
import type { ConversationResponder } from "@lervo/interaction";
import type { ArtifactStore, EventStore } from "@lervo/storage-contract";

import { ConversationDeliberationArtifactSource } from "./conversation-deliberation-artifact-source.js";
import { createConversationDeliberationCliExecutionPorts } from "./conversation-deliberation-cli-executor.js";
import { createConversationDeliberationResultSource } from "./conversation-deliberation-result-source.js";
import { ConversationDeliberationLoop } from "./conversation-deliberation-loop.js";
import { ConversationDeliberationOutcomeCoordinator } from "./conversation-deliberation-outcomes.js";
import { FileConversationEventCursor } from "./conversation-event-cursor.js";
import type { NodeDiscordConversationConfig } from "./config-types.js";
import { ConversationDeliberationActionResponder } from "./conversation-deliberation-action-responder.js";
import { runConversationDeliberationCycle } from "./conversation-deliberation-cycle.js";
import type { DiscordPlatformActionResponder } from "./discord-conversation-mode.js";
import type { ConversationDeliberationParticipantAssignmentPort } from "./conversation-deliberation-participant-router.js";

export class DiscordConversationDeliberationRuntime {
  readonly responder: ConversationResponder;
  readonly naturalLanguageEffect: ManagedConversationSurfaceEffect | null;
  readonly actionResponder: DiscordPlatformActionResponder;
  readonly applicationOptions: NonNullable<ConversationApplicationOptions["deliberations"]>;
  private deliberations: ConversationDeliberationPort | null = null;
  private loop: ConversationDeliberationLoop | null = null;
  private readonly outcomes: ConversationDeliberationOutcomeCoordinator;

  private constructor(
    config: NonNullable<NodeDiscordConversationConfig["deliberation"]>,
    integrationId: string,
    projectId: string,
    repositoryRoot: string,
    providerExecutables: Partial<Record<"codex" | "claude", string>> | undefined,
    providerModels: Partial<Record<"codex" | "claude", string>> | undefined,
    providerReasoningEfforts:
      Partial<Record<"codex" | "claude", "low" | "medium" | "high" | "xhigh" | "max">> | undefined,
    participantAssignments: ConversationDeliberationParticipantAssignmentPort | undefined,
    artifactStore: ArtifactStore,
    private readonly artifactSource: ConversationDeliberationArtifactSource | null,
    private readonly onFailure: (error: unknown) => void,
  ) {
    const execution = createConversationDeliberationCliExecutionPorts({
      executable: config.cliExecutable,
      repositoryRoot,
      ...(providerExecutables === undefined ? {} : { providerExecutables }),
      ...(providerModels === undefined ? {} : { providerModels }),
      ...(providerReasoningEfforts === undefined ? {} : { providerReasoningEfforts }),
      ...(config.processTimeoutMs === undefined
        ? {}
        : { processTimeoutMs: config.processTimeoutMs }),
      ...(participantAssignments === undefined ? {} : { participantAssignments }),
    });
    this.applicationOptions = {
      bindings: config.principals.map((principal) => ({
        projectId,
        ...principal,
      })),
      executor: execution.start,
      reconciliationSource: execution.reconciliation,
      resumeExecutor: execution.resume,
      workerId: config.workerId,
      resumeWorkerId: `${config.workerId.slice(0, 120)}:resume`,
      ...(config.leaseDurationMs === undefined ? {} : { leaseDurationMs: config.leaseDurationMs }),
      ...(config.maxRecords === undefined ? {} : { maxRecords: config.maxRecords }),
    };
    const action =
      config.defaultPolicyId === undefined
        ? null
        : new ConversationDeliberationActionResponder({
            policyId: config.defaultPolicyId,
            artifactStore,
            deliberations: () => this.deliberations,
            preflight: ({ policyId, projectId, conversationId }) =>
              participantAssignments?.preflight({ policyId, projectId, conversationId }) ?? {
                participantIds: [],
              },
          });
    this.naturalLanguageEffect = action?.surfaceEffect ?? null;
    this.actionResponder =
      action ??
      ({
        availableEffects: [],
        respond: () => {
          throw new Error("Natural-language deliberation is not configured.");
        },
      } satisfies DiscordPlatformActionResponder);
    this.outcomes = new ConversationDeliberationOutcomeCoordinator({
      projectId,
      integrationId,
      conversationIds: config.notificationConversationIds ?? [],
      artifactStore,
      resultSource: createConversationDeliberationResultSource({
        executable: config.cliExecutable,
        repositoryRoot,
        ...(config.processTimeoutMs === undefined
          ? {}
          : { processTimeoutMs: config.processTimeoutMs }),
      }),
      maximumReconciliationAttempts: config.maximumReconciliationAttempts ?? 3,
    });
    this.responder = {
      respond: (input) => {
        if (this.deliberations === null) {
          throw new Error("The conversation deliberation runtime is not attached.");
        }
        return new ConversationDeliberationResponder({
          artifactStore,
          deliberations: this.deliberations,
          writingContract: fixedConversationStatusWritingContract,
        }).respond(input);
      },
    };
  }

  static async open(input: {
    config: NonNullable<NodeDiscordConversationConfig["deliberation"]>;
    integrationId: string;
    projectId: string;
    repositoryRoot: string;
    providerExecutables?: Partial<Record<"codex" | "claude", string>>;
    providerModels?: Partial<Record<"codex" | "claude", string>>;
    providerReasoningEfforts?: Partial<
      Record<"codex" | "claude", "low" | "medium" | "high" | "xhigh" | "max">
    >;
    participantAssignments?: ConversationDeliberationParticipantAssignmentPort;
    dataDirectory: string;
    artifactStore: ArtifactStore;
    repositoryArtifactStore: ArtifactStore;
    repositoryEvents?: Pick<EventStore, "latest" | "list">;
    onFailure(error: unknown): void;
  }): Promise<DiscordConversationDeliberationRuntime> {
    const metadata = await lstat(input.config.cliExecutable);
    if (!metadata.isFile()) throw new Error("The deliberation CLI executable is not a file.");
    await access(input.config.cliExecutable, constants.X_OK);
    const artifactSource =
      input.repositoryEvents === undefined
        ? null
        : new ConversationDeliberationArtifactSource({
            projectId: input.projectId,
            integrationId: input.integrationId,
            events: input.repositoryEvents,
            repositoryArtifacts: input.repositoryArtifactStore,
            conversationArtifacts: input.artifactStore,
            cursor: new FileConversationEventCursor(
              resolve(input.dataDirectory, "deliberation-artifact-cursor.json"),
              {
                cursorKind: "deliberation.artifact",
                projectId: input.projectId,
                integrationId: input.integrationId,
              },
            ),
            ...(input.participantAssignments === undefined
              ? {}
              : { participantPublisher: input.participantAssignments }),
          });
    await artifactSource?.initialize();
    return new DiscordConversationDeliberationRuntime(
      input.config,
      input.integrationId,
      input.projectId,
      input.repositoryRoot,
      input.providerExecutables,
      input.providerModels,
      input.providerReasoningEfforts,
      input.participantAssignments,
      input.artifactStore,
      artifactSource,
      input.onFailure,
    );
  }

  attach(
    application: ConversationApplication,
    intervalMs: number,
    onChangeSignal?: (failure: unknown) => void,
  ): void {
    if (this.deliberations !== null || application.deliberations === null) {
      throw new Error("The conversation deliberation application cannot be attached.");
    }
    this.deliberations = application.deliberations;
    this.artifactSource?.attach(application);
    this.loop = new ConversationDeliberationLoop({
      ...(application.subscribeChanges === undefined
        ? {}
        : {
            subscribe: (notify: () => void) =>
              application.subscribeChanges!("deliberation", notify),
          }),
      nextWakeupAt: () => {
        const at = application.nextDeliberationWakeupAt?.() ?? null;
        if (this.artifactSource?.hasMore === true) return Date.now();
        return this.outcomes.hasPending ? Math.min(at ?? Infinity, Date.now() + intervalMs) : at;
      },
      runCycle: async () => {
        await runConversationDeliberationCycle({
          application,
          artifacts: this.artifactSource,
          outcomes: this.outcomes,
          projectionIntervalMs: intervalMs,
        });
      },
      onFailure: this.onFailure,
      ...(onChangeSignal === undefined ? {} : { onChangeSignal }),
      continueOnFailure: true,
      intervalMs,
    });
    this.loop.start();
  }

  stop(): Promise<void> {
    return this.loop?.stop() ?? Promise.resolve();
  }
}
