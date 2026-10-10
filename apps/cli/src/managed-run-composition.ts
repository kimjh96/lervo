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
    selectionBoundary,
    executable,
  }) =>
    provider === "codex"
      ? new CodexAdapter({
          ...(executable === undefined ? {} : { executable }),
          repositoryRoot,
          resolveArtifact,
          ...(structuredOutputSchema === undefined ? {} : { structuredOutputSchema }),
          ...(selectionBoundary === "read_only_no_tools"
            ? {
                sandbox: "read-only",
                approvalPolicy: "never",
                transport: {
                  kind: "responses_api_no_tools",
                  ...(process.env.OPENAI_API_KEY === undefined
                    ? {}
                    : { apiKey: process.env.OPENAI_API_KEY }),
                  ...(process.env.LERVO_CODEX_NO_TOOL_MODEL === undefined
                    ? {}
                    : { model: process.env.LERVO_CODEX_NO_TOOL_MODEL }),
                } as const,
              }
            : {}),
        })
      : new ClaudeAdapter({
          ...(executable === undefined ? {} : { executable }),
          repositoryRoot,
          resolveArtifact,
          ...(structuredOutputSchema === undefined ? {} : { structuredOutputSchema }),
          ...(selectionBoundary === "read_only_no_tools"
            ? { permissionMode: "plan", tools: [] }
            : {}),
        }),
  createId: (prefix) => `${prefix}_${randomUUID().replaceAll("-", "")}`,
  now: () => new Date(),
  createSemanticEvaluator: createLocalProviderWritingEvaluator,
  groundProductionRequest,
};
