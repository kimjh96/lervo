import { randomUUID } from "node:crypto";

import type { DiscordConversationAdapter } from "@lervo/adapter-discord";
import { createLocalProviderWritingEvaluator } from "@lervo/provider-writing-evaluator";
import { nodeRoleRoute, optionalRouteFields } from "./node-model-route.js";
import type { ArtifactStore } from "@lervo/storage-contract";

import type { NodeDiscordConversationConfig } from "./config-types.js";
import { conversationResultEvaluationSelection } from "./conversation-result-evaluation.js";
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
  const evaluation = conversationResultEvaluationSelection(config);
  // ADR-0612: result evaluation is the `review` role, chosen at each evaluation; the configured
  // evaluation route stands while the role is unset.
  const evaluationRoute = () =>
    nodeRoleRoute({
      role: "review",
      configured: { provider: evaluation.provider, ...optionalRouteFields(evaluation) },
    });
  return new ConversationResultRuntime({
    workerId: `${config.workerId}:result`,
    store: input.store,
    artifacts: input.artifacts,
    adapter: input.adapter,
    semanticEvaluator: createLocalProviderWritingEvaluator({
      provider: () => evaluationRoute().provider,
      projectId: input.projectId,
      createAdapter: (adapterInput) => {
        const route = evaluationRoute();
        return createNodeProviderAdapter({
          ...adapterInput,
          ...(input.providerExecutables?.[adapterInput.provider] === undefined
            ? {}
            : { executable: input.providerExecutables[adapterInput.provider] }),
          ...(route.provider === adapterInput.provider ? optionalRouteFields(route) : {}),
        });
      },
      createId: (prefix) => `${prefix}_${randomUUID().replaceAll("-", "")}`,
      now: () => new Date(),
    }),
    source: new RepositoryConversationResultSource(input.repositoryRoot),
  });
}
