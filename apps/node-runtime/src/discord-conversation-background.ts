import type { ConversationApplication } from "@lervo/conversation-app";
import type { ArtifactStore } from "@lervo/storage-contract";
import type { NodeDiscordConversationRuntimeOptions } from "./discord-conversation-runtime-types.js";
import type { DiscordConversationDeliberationRuntime } from "./discord-conversation-deliberation-runtime.js";
import {
  ConversationInteractionRetryLoop,
  reportConversationInteractionRetryFailure,
} from "./conversation-interaction-retry-loop.js";
import { startDiscordConversationRepositorySignals } from "./discord-conversation-repository-signals.js";
import { ConversationDiscussionDeadlineLoop } from "./conversation-discussion-deadline-loop.js";
import { changeSignalAttention } from "./change-signal-attention.js";
import type { ConversationDiscussionRuntime } from "./conversation-discussion-runtime.js";

/** Owns activation and failed-start cleanup for conversation background work. */
export function startDiscordConversationBackground(input: {
  options: NodeDiscordConversationRuntimeOptions;
  application: ConversationApplication;
  artifacts: ArtifactStore;
  deliberation: DiscordConversationDeliberationRuntime | null;
  discussion: ConversationDiscussionRuntime;
  fail(code: string): void;
}) {
  const { options, application } = input;
  const config = options.config;
  if (config.repositorySignals !== undefined && options.repositoryEvents === undefined) {
    throw new Error("Repository signals require the Node repository event reader.");
  }
  const interactionRetryLoop = new ConversationInteractionRetryLoop({
    ...(application.subscribeChanges === undefined
      ? {}
      : {
          subscribe: (notify: () => void) => application.subscribeChanges!("interaction", notify),
        }),
    nextWakeupAt: () => application.nextInteractionWakeupAt?.(config.integrationId) ?? null,
    runCycle: async () => {
      await application.runInteractionRetryCycle?.(config.integrationId);
    },
    // A durable retry failure must not disable fresh ingress or other bindings.
    onFailure: (error) => reportConversationInteractionRetryFailure(error, options.onError),
    onChangeSignal: changeSignalAttention(options.repositoryRoot),
  });
  try {
    interactionRetryLoop.start();
    const discussionDeadlineLoop = new ConversationDiscussionDeadlineLoop({
      integrationId: config.integrationId,
      application,
      discussion: input.discussion,
      onChangeSignal: changeSignalAttention(options.repositoryRoot),
      onFailure: (error) =>
        options.onError?.(
          error instanceof Error
            ? error
            : new Error("The discussion deadline cycle failed.", { cause: error }),
        ),
    });
    discussionDeadlineLoop.start();
    input.deliberation?.attach(
      application,
      config.deliberation!.pollIntervalMs ?? 2_000,
      changeSignalAttention(options.repositoryRoot),
    );
    const repositorySignalLoop =
      options.repositoryEvents === undefined
        ? null
        : startDiscordConversationRepositorySignals({
            config,
            projectId: options.project.projectId,
            dataDirectory: options.dataDirectory,
            events: options.repositoryEvents,
            artifacts: input.artifacts,
            application,
            onChangeSignal: changeSignalAttention(options.repositoryRoot),
            onFailure: () => input.fail("repository_signal_failed"),
          });
    return { interactionRetryLoop, repositorySignalLoop, discussionDeadlineLoop };
  } catch (error) {
    void interactionRetryLoop.stop();
    throw error;
  }
}
