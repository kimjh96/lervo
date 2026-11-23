import { randomUUID } from "node:crypto";

import type { DiscordConversationAdapter } from "@lervo/adapter-discord";
import { createConversationReviewEvaluator } from "./conversation-review-evaluator.js";
import type { ReadNodeModelSelection } from "./node-model-route.js";
import type { ArtifactStore } from "@lervo/storage-contract";

import type { NodeDiscordConversationConfig } from "./config-types.js";
import { conversationResultEvaluationSelection } from "./conversation-result-evaluation.js";
import { ConversationResultRuntime } from "./conversation-result-runtime.js";
import { RepositoryConversationResultSource } from "./conversation-result-source.js";
import type { SQLiteConversationResultStore } from "./conversation-result-store.js";

export function createDiscordConversationResultRuntime(input: {
  config: NodeDiscordConversationConfig;
  projectId: string;
  repositoryRoot: string;
  providerExecutables?: Partial<Record<"codex" | "claude", string>>;
  store: SQLiteConversationResultStore;
  artifacts: ArtifactStore;
  adapter: DiscordConversationAdapter;
  /** Replaced only in tests. */
  readModelSelection?: ReadNodeModelSelection;
}): ConversationResultRuntime {
  const { config } = input;
  const evaluation = conversationResultEvaluationSelection(config);
  return new ConversationResultRuntime({
    workerId: `${config.workerId}:result`,
    store: input.store,
    artifacts: input.artifacts,
    adapter: input.adapter,
    semanticEvaluator: createConversationReviewEvaluator({
      configured: evaluation,
      projectId: input.projectId,
      ...(input.providerExecutables === undefined
        ? {}
        : { providerExecutables: input.providerExecutables }),
      ...(input.readModelSelection === undefined
        ? {}
        : { readModelSelection: input.readModelSelection }),
      createId: (prefix) => `${prefix}_${randomUUID().replaceAll("-", "")}`,
    }),
    source: new RepositoryConversationResultSource(input.repositoryRoot),
  });
}
