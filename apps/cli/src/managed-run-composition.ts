import { randomUUID } from "node:crypto";
import { ClaudeAdapter } from "@lervo/adapter-claude";
import { CodexAdapter } from "@lervo/adapter-codex";
import { openProjectStorage } from "@lervo/project-storage";
import { createLocalProviderWritingEvaluator } from "./managed-writing-evaluator.js";
import { groundProductionRequest } from "./semantic-grounding.js";
import type { ManagedRunDependencies } from "./managed-run-types.js";

export const defaultDependencies: ManagedRunDependencies = {
  openStorage: openProjectStorage,
  createAdapter: ({
    provider,
    repositoryRoot,
    resolveArtifact,
    structuredOutputSchema,
    executable,
    model,
    reasoningEffort,
  }) => {
    const options = {
      ...(executable === undefined ? {} : { executable }),
      repositoryRoot,
      resolveArtifact,
      ...(structuredOutputSchema === undefined ? {} : { structuredOutputSchema }),
      ...(model === undefined ? {} : { model }),
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    };
    return provider === "codex" ? new CodexAdapter(options) : new ClaudeAdapter(options);
  },
  createId: (prefix) => `${prefix}_${randomUUID().replaceAll("-", "")}`,
  now: () => new Date(),
  createSemanticEvaluator: createLocalProviderWritingEvaluator,
  groundProductionRequest,
};
