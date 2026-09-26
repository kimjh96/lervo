import { resolve } from "node:path";

import { ClaudeRepositoryWorkTurnExecutor } from "@lervo/adapter-claude";
import { CodexRepositoryWorkTurnExecutor } from "@lervo/adapter-codex";
import type { RepositoryWorkTurnExecutor } from "@lervo/adapter-contract";
import type { ArtifactStore } from "@lervo/storage-contract";

import { NormalizationCandidatePreparer } from "./conversation-normalization-candidate.js";
import { ConversationRepositoryWorkResponder } from "./conversation-repository-work-responder.js";
import { SQLiteConversationRepositoryWorkStore } from "./conversation-repository-work-store.js";
import type {
  NodeDiscordConversationConfig,
  NodeRepositoryWorkExecutionProfile,
  NodeRepositoryWorkExecutionProfilePolicy,
  NodeRuntimeConfig,
} from "./config-types.js";
import { discordWorkforceExecution } from "./discord-workforce-execution.js";

export function openDiscordConversationRepositoryWork(input: {
  config: NodeDiscordConversationConfig & {
    routing: NonNullable<NodeDiscordConversationConfig["routing"]>;
  };
  repositoryRoot: string;
  repositoryReplica?: NodeRuntimeConfig["repositoryReplica"];
  dataDirectory: string;
  artifactStore: ArtifactStore;
  parentAgentId: string;
  runtimeConfigPath?: string;
  providerExecutables?: Partial<Record<"codex" | "claude", string>>;
  providerModels?: Partial<Record<"codex" | "claude", string>>;
  providerReasoningEfforts?: Partial<
    Record<"codex" | "claude", "low" | "medium" | "high" | "xhigh" | "max">
  >;
  providerExecutionProfiles?: Record<
    NodeRepositoryWorkExecutionProfile,
    NodeRepositoryWorkExecutionProfilePolicy
  >;
  authorizedEffectRequesters?: readonly {
    participantId: string;
    roleId: string;
    conversationId: string;
  }[];
  executor?: RepositoryWorkTurnExecutor;
}): {
  responder: ConversationRepositoryWorkResponder;
  store: SQLiteConversationRepositoryWorkStore;
} {
  const store = SQLiteConversationRepositoryWorkStore.open(
    resolve(input.dataDirectory, "repository-work.sqlite"),
  );
  const executors: Partial<Record<"codex" | "claude", RepositoryWorkTurnExecutor>> =
    input.executor === undefined
      ? {
          codex: new CodexRepositoryWorkTurnExecutor(input.providerExecutables?.codex),
          claude: new ClaudeRepositoryWorkTurnExecutor(input.providerExecutables?.claude),
        }
      : { [input.executor.provider]: input.executor };
  return {
    store,
    responder: new ConversationRepositoryWorkResponder({
      repositoryRoot: input.repositoryRoot,
      ...(input.repositoryReplica === undefined
        ? {}
        : { repositoryReplica: input.repositoryReplica }),
      artifactStore: input.artifactStore,
      store,
      parentAgentId: input.parentAgentId,
      workerSelection:
        discordWorkforceExecution(input.config, input.runtimeConfigPath) === "conversation_delegate"
          ? "conversation_delegate"
          : "configured_agent",
      executors,
      ...(input.providerModels === undefined ? {} : { models: input.providerModels }),
      ...(input.providerReasoningEfforts === undefined
        ? {}
        : { reasoningEfforts: input.providerReasoningEfforts }),
      ...(input.providerExecutionProfiles === undefined
        ? {}
        : { executionProfiles: input.providerExecutionProfiles }),
      ...(input.authorizedEffectRequesters === undefined
        ? {}
        : { authorizedEffectRequesters: input.authorizedEffectRequesters }),
      defaultProvider: input.config.command.provider,
      normalization: new NormalizationCandidatePreparer({
        repositoryRoot: input.repositoryRoot,
        provider: input.config.command.provider,
        ...(input.providerExecutables === undefined
          ? {}
          : { executables: input.providerExecutables }),
        log: (line) => process.stderr.write(`${line}\n`),
      }),
      timeoutMs: input.config.routing.workTimeoutMs ?? 1_800_000,
    }),
  };
}
