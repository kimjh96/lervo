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
import type { NodeDiscordConversationConfig } from "./config-types.js";

export class DiscordConversationDeliberationRuntime {
  readonly responder: ConversationResponder;
  readonly applicationOptions: NonNullable<ConversationApplicationOptions["deliberations"]>;
  private deliberations: ConversationDeliberationPort | null = null;
  private loop: ConversationDeliberationLoop | null = null;

  private constructor(
    config: NonNullable<NodeDiscordConversationConfig["deliberation"]>,
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
      resumeExecutor: execution.resume,
      workerId: config.workerId,
      resumeWorkerId: `${config.workerId.slice(0, 120)}:resume`,
      ...(config.leaseDurationMs === undefined ? {} : { leaseDurationMs: config.leaseDurationMs }),
      ...(config.maxRecords === undefined ? {} : { maxRecords: config.maxRecords }),
    };
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
      runCycle: async () => {
        await application.runDeliberationWorkerCycle();
        await application.runDeliberationResumeWorkerCycle();
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
