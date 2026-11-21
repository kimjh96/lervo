import { watchLocalEventChanges } from "./local-event-wakeup.js";
import { resolve } from "node:path";

import type { ConversationApplication } from "@lervo/conversation-app";
import type { ArtifactStore, EventStore } from "@lervo/storage-contract";

import { FileConversationRepositorySignalCursor } from "./conversation-repository-signal-cursor.js";
import { ConversationRepositorySignalLoop } from "./conversation-repository-signal-loop.js";
import { RepositoryConversationSignalSource } from "./conversation-repository-signal-source.js";
import type { NodeDiscordConversationConfig } from "./config-types.js";

export function startDiscordConversationRepositorySignals(input: {
  config: NodeDiscordConversationConfig;
  projectId: string;
  dataDirectory: string;
  events: Pick<EventStore, "latest" | "list"> & { readonly path?: string };
  artifacts: ArtifactStore;
  application: ConversationApplication;
  onFailure(): void;
  onChangeSignal?(failure: unknown): void;
}): ConversationRepositorySignalLoop | null {
  const configured = input.config.repositorySignals;
  if (configured === undefined) return null;
  const source = new RepositoryConversationSignalSource({
    projectId: input.projectId,
    integrationId: input.config.integrationId,
    conversationIds: input.config.conversations.map((binding) => binding.conversationId),
    mappings: configured.mappings,
    events: input.events,
    artifacts: input.artifacts,
    cursor: new FileConversationRepositorySignalCursor(
      resolve(input.dataDirectory, "repository-signal-cursor.json"),
      { projectId: input.projectId, integrationId: input.config.integrationId },
    ),
    dispatch: async (event) => {
      await input.application.handleInboundEvent!(event);
      await input.application.runDeliveryCycle!(input.config.integrationId);
    },
  });
  let more = false;
  const loop = new ConversationRepositorySignalLoop({
    ...(input.events.path === undefined
      ? {}
      : {
          subscribe: (notify: () => void) =>
            watchLocalEventChanges(
              { path: input.events.path!, latest: () => input.events.latest() },
              notify,
            ),
        }),
    nextWakeupAt: () => (more ? Date.now() : null),
    runCycle: async () => {
      const result = await source.runCycle();
      more = result.eventCount === 100;
      return result;
    },
    onFailure: input.onFailure,
    ...(input.onChangeSignal === undefined ? {} : { onChangeSignal: input.onChangeSignal }),
    intervalMs: configured.pollIntervalMs ?? 2_000,
  });
  loop.start();
  return loop;
}
