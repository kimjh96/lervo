import type { ConversationApplication } from "@lervo/conversation-app";
import type { ArtifactStore } from "@lervo/storage-contract";
import type { NodeDiscordConversationRuntimeOptions } from "./discord-conversation-runtime-types.js";
import type { DiscordConversationDeliberationRuntime } from "./discord-conversation-deliberation-runtime.js";
import {
  ConversationInteractionRetryLoop,
  reportConversationInteractionRetryFailure,
} from "./conversation-interaction-retry-loop.js";
import { startDiscordConversationRepositorySignals } from "./discord-conversation-repository-signals.js";

/** Owns activation and failed-start cleanup for conversation background work. */
export function startDiscordConversationBackground(input: {
  options: NodeDiscordConversationRuntimeOptions;
  application: ConversationApplication;
  artifacts: ArtifactStore;
  deliberation: DiscordConversationDeliberationRuntime | null;
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
  });
  try {
    interactionRetryLoop.start();
    input.deliberation?.attach(application, config.deliberation!.pollIntervalMs ?? 2_000);
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
            onFailure: () => input.fail("repository_signal_failed"),
          });
    return { interactionRetryLoop, repositorySignalLoop };
  } catch (error) {
    void interactionRetryLoop.stop();
    throw error;
  }
}
