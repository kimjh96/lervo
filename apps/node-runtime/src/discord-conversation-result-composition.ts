import { randomUUID } from "node:crypto";

import type { DiscordConversationAdapter } from "@lervo/adapter-discord";
import { createLocalProviderWritingEvaluator } from "@lervo/provider-writing-evaluator";
import type { ArtifactStore } from "@lervo/storage-contract";

import type { NodeDiscordConversationConfig } from "./config-types.js";
import { ConversationResultRuntime } from "./conversation-result-runtime.js";
import { RepositoryConversationResultSource } from "./conversation-result-source.js";
import type { SQLiteConversationResultStore } from "./conversation-result-store.js";
import { createNodeProviderAdapter } from "./managed-provider-runtime.js";

export function createDiscordConversationResultRuntime(input: {
  config: NodeDiscordConversationConfig;
  projectId: string;
  repositoryRoot: string;
  providerExecutables?: Partial<Record<"codex" | "claude", string>>;
  store: SQLiteConversationResultStore;
  artifacts: ArtifactStore;
  adapter: DiscordConversationAdapter;
}): ConversationResultRuntime {
  const { config } = input;
  return new ConversationResultRuntime({
    workerId: `${config.workerId}:result`,
    store: input.store,
    artifacts: input.artifacts,
    adapter: input.adapter,
    semanticEvaluator: createLocalProviderWritingEvaluator({
      provider: config.routing?.evaluation?.provider ?? config.command.provider,
      projectId: input.projectId,
      createAdapter: (adapterInput) =>
        createNodeProviderAdapter({
          ...adapterInput,
          ...(input.providerExecutables?.[adapterInput.provider] === undefined
            ? {}
            : { executable: input.providerExecutables[adapterInput.provider] }),
          ...(config.routing?.evaluation?.model === undefined
            ? {}
            : { model: config.routing.evaluation.model }),
          ...(config.routing?.evaluation?.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: config.routing.evaluation.reasoningEffort }),
        }),
      createId: (prefix) => `${prefix}_${randomUUID().replaceAll("-", "")}`,
      now: () => new Date(),
    }),
    source: new RepositoryConversationResultSource(input.repositoryRoot),
  });
}
