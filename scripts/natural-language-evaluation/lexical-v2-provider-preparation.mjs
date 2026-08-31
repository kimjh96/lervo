import { randomUUID } from "node:crypto";

import { ClaudeAdapter, ClaudeSdkAgentClient } from "../../packages/adapter-claude/dist/index.js";
import {
  CodexAdapter,
  CodexStdioAppServerClient,
} from "../../packages/adapter-codex/dist/index.js";

const defaultDependencies = {
  connectCodex: (options) => CodexStdioAppServerClient.connect(options),
  connectClaude: (options) => ClaudeSdkAgentClient.connect(options),
  now: () => Date.now(),
  uuid: () => randomUUID(),
};

export async function prepareLexicalV2ProviderAdapter(input, dependencies = defaultDependencies) {
  const startedAt = dependencies.now();
  if (input.provider === "codex") {
    const client = await dependencies.connectCodex({
      executable: "codex",
      cwd: input.repositoryRoot,
      requestTimeoutMs: 30_000,
    });
    return {
      adapter: new CodexAdapter({
        repositoryRoot: input.repositoryRoot,
        model: input.model,
        sandbox: "read-only",
        approvalPolicy: "never",
        ...(input.reasoningEffort === undefined ? {} : { reasoningEffort: input.reasoningEffort }),
        ...(input.structuredOutputSchema === undefined
          ? {}
          : { structuredOutputSchema: input.structuredOutputSchema }),
        clientFactory: async () => client,
      }),
      durationMs: dependencies.now() - startedAt,
    };
  }

  const providerSessionId = dependencies.uuid();
  const client = await dependencies.connectClaude({
    providerSessionId,
    cwd: input.repositoryRoot,
    model: input.model,
    permissionMode: "plan",
    requestTimeoutMs: 30_000,
    createMessageId: dependencies.uuid,
    tools: [],
    ...(input.reasoningEffort === undefined ? {} : { reasoningEffort: input.reasoningEffort }),
    ...(input.structuredOutputSchema === undefined
      ? {}
      : {
          outputFormat: {
            type: "json_schema",
            schema: input.structuredOutputSchema,
          },
        }),
    capabilityActivations: [],
  });
  return {
    adapter: new ClaudeAdapter({
      repositoryRoot: input.repositoryRoot,
      model: input.model,
      permissionMode: "plan",
      tools: [],
      ...(input.reasoningEffort === undefined ? {} : { reasoningEffort: input.reasoningEffort }),
      ...(input.structuredOutputSchema === undefined
        ? {}
        : { structuredOutputSchema: input.structuredOutputSchema }),
      createProviderSessionId: () => providerSessionId,
      clientFactory: async () => client,
    }),
    durationMs: dependencies.now() - startedAt,
  };
}
