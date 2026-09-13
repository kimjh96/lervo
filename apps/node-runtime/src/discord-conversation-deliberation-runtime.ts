import { constants } from "node:fs";
import { access, lstat } from "node:fs/promises";

import type {
  ConversationApplication,
  ConversationApplicationOptions,
} from "@lervo/conversation-app";
import {
  ConversationDeliberationResponder,
  type ConversationDeliberationPort,
} from "@lervo/conversation-control";
import { fixedConversationStatusWritingContract } from "@lervo/core";
import type { ConversationResponder } from "@lervo/interaction";
import type { ArtifactStore } from "@lervo/storage-contract";

import { createConversationDeliberationCliExecutionPorts } from "./conversation-deliberation-cli-executor.js";
import { ConversationDeliberationLoop } from "./conversation-deliberation-loop.js";
import { ConversationDeliberationOutcomeCoordinator } from "./conversation-deliberation-outcomes.js";
import type { NodeDiscordConversationConfig } from "./config-types.js";

export class DiscordConversationDeliberationRuntime {
  readonly responder: ConversationResponder;
  readonly applicationOptions: NonNullable<ConversationApplicationOptions["deliberations"]>;
  private deliberations: ConversationDeliberationPort | null = null;
  private loop: ConversationDeliberationLoop | null = null;
  private readonly outcomes: ConversationDeliberationOutcomeCoordinator;

  private constructor(
    config: NonNullable<NodeDiscordConversationConfig["deliberation"]>,
    integrationId: string,
    projectId: string,
    repositoryRoot: string,
    artifactStore: ArtifactStore,
    private readonly onFailure: () => void,
  ) {
    const execution = createConversationDeliberationCliExecutionPorts({
      executable: config.cliExecutable,
      repositoryRoot,
      ...(config.processTimeoutMs === undefined
        ? {}
        : { processTimeoutMs: config.processTimeoutMs }),
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
    this.outcomes = new ConversationDeliberationOutcomeCoordinator({
      projectId,
      integrationId,
      conversationIds: config.notificationConversationIds ?? [],
      artifactStore,
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
    artifactStore: ArtifactStore;
    onFailure(): void;
  }): Promise<DiscordConversationDeliberationRuntime> {
    const metadata = await lstat(input.config.cliExecutable);
    if (!metadata.isFile()) throw new Error("The deliberation CLI executable is not a file.");
    await access(input.config.cliExecutable, constants.X_OK);
    return new DiscordConversationDeliberationRuntime(
      input.config,
      input.integrationId,
      input.projectId,
      input.repositoryRoot,
      input.artifactStore,
      input.onFailure,
    );
  }

  attach(application: ConversationApplication, intervalMs: number): void {
    if (this.deliberations !== null || application.deliberations === null) {
      throw new Error("The conversation deliberation application cannot be attached.");
    }
    this.deliberations = application.deliberations;
    this.loop = new ConversationDeliberationLoop({
      ...(application.subscribeChanges === undefined
        ? {}
        : {
            subscribe: (notify: () => void) =>
              application.subscribeChanges!("deliberation", notify),
          }),
      nextWakeupAt: () => {
        const at = application.nextDeliberationWakeupAt?.() ?? null;
        return this.outcomes.hasPending ? Math.min(at ?? Infinity, Date.now() + intervalMs) : at;
      },
      runCycle: async () => {
        const start = await application.runDeliberationWorkerCycle();
        await this.outcomes.observe(application, start);
        const resume = await application.runDeliberationResumeWorkerCycle();
        await this.outcomes.observe(application, resume);
        await this.outcomes.reconcilePending(application);
      },
      onFailure: this.onFailure,
      intervalMs,
    });
    this.loop.start();
  }

  stop(): Promise<void> {
    return this.loop?.stop() ?? Promise.resolve();
  }
}
