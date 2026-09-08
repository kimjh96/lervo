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
  events: Pick<EventStore, "latest" | "list">;
  artifacts: ArtifactStore;
  application: ConversationApplication;
  onFailure(): void;
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
  const loop = new ConversationRepositorySignalLoop({
    runCycle: () => source.runCycle(),
    onFailure: input.onFailure,
    intervalMs: configured.pollIntervalMs ?? 2_000,
  });
  loop.start();
  return loop;
}
