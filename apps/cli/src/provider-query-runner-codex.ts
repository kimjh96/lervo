import type { ModelReasoningEffort } from "@lervo/execution-contract";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { CodexStdioAppServerClient } from "@lervo/adapter-codex";
import { canonicalJson } from "@lervo/repository-knowledge";
import {
  assertCodexHasNoModelTools,
  codexNoCapabilityFeatureArguments,
  parseProviderResultText,
  providerNativeResponseSchema,
  providerResponseContractSchema,
  type NoCapabilityProviderJsonRunner,
  type ProviderJsonUsage,
} from "@lervo/repository-knowledge-compiler";
import {
  assertProviderOutputSchemaForSource,
  assertProviderPromptAsksNoHashCopy,
  providerWireSchema,
} from "@lervo/schemas";

type CodexQueryClient = Pick<
  CodexStdioAppServerClient,
  "startThread" | "startTurn" | "notifications" | "interruptTurn" | "unsubscribe" | "close"
>;

export interface CodexPersistentQueryRunnerDependencies {
  createDirectory(): Promise<string>;
  removeDirectory(path: string): Promise<void>;
  assertNoModelTools(input: { executable: string; cwd: string; timeoutMs: number }): Promise<void>;
  connect(input: {
    executable: string;
    commandArguments: readonly string[];
    cwd: string;
    requestTimeoutMs: number;
  }): Promise<CodexQueryClient>;
}

const defaultDependencies: CodexPersistentQueryRunnerDependencies = {
  createDirectory: () => mkdtemp(resolve(tmpdir(), "lervo-codex-query-runner-")),
  removeDirectory: (path) => rm(path, { recursive: true, force: true }),
  assertNoModelTools: assertCodexHasNoModelTools,
  connect: (input) => CodexStdioAppServerClient.connect(input),
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function codexUsage(params: Record<string, unknown>): ProviderJsonUsage | null {
  const tokenUsage = record(params.tokenUsage);
  const total = record(tokenUsage?.total);
  if (total === null) return null;
  const values = {
    inputTokens: nonNegativeInteger(total.inputTokens),
    cachedInputTokens: nonNegativeInteger(total.cachedInputTokens),
    outputTokens: nonNegativeInteger(total.outputTokens),
    reasoningOutputTokens: nonNegativeInteger(total.reasoningOutputTokens),
    totalTokens: nonNegativeInteger(total.totalTokens),
    contextWindow: nonNegativeInteger(tokenUsage?.modelContextWindow),
  };
  if (Object.values(values).some((item) => item === null)) return null;
  return values as ProviderJsonUsage;
}

async function observedTurn(input: {
  client: CodexQueryClient;
  cwd: string;
  systemPrompt: string;
  model?: string;
  reasoningEffort: ModelReasoningEffort;
  timeoutMs: number;
  value: unknown;
  signal?: AbortSignal;
}): Promise<{ value: unknown; usage: ProviderJsonUsage | null }> {
  const contract = providerResponseContractSchema(input.value);
  // ADR-0608: the schema is checked as built, against the request's own data, before any native
  // conversion; only then are its reference-kind marks removed for the provider.
  assertProviderOutputSchemaForSource(contract, {
    ...(input.value as Record<string, unknown>),
    responseContract: null,
  });
  const schema = providerNativeResponseSchema(providerWireSchema(contract));
  const request = providerWireRequest(input.value);
  assertProviderPromptAsksNoHashCopy(
    input.systemPrompt,
    ...Object.entries(input.value as Record<string, unknown>)
      .filter(([key, value]) => typeof value === "string" && !/^untrusted/iu.test(key))
      .map(([, value]) => value as string),
  );
  const thread = await input.client.startThread({
    cwd: input.cwd,
    approvalPolicy: "never",
    sandbox: "read-only",
    ...(input.model === undefined ? {} : { model: input.model }),
    baseInstructions: input.systemPrompt,
    config: { features: { hooks: false }, mcp_servers: {} },
  });
  let providerTurnId: string | undefined;
  const controller = new AbortController();
  const abort = () => controller.abort(input.signal?.reason);
  input.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const turn = await input.client.startTurn(thread.threadId, canonicalJson(request), {
      outputSchema: schema,
      reasoningEffort: input.reasoningEffort,
    });
    providerTurnId = turn.turnId;
    let content: string | null = null;
    let usage: ProviderJsonUsage | null = null;
    let completed = false;
    for await (const raw of input.client.notifications(controller.signal)) {
      const message = record(raw);
      const params = record(message?.params);
      const eventThreadId =
        typeof params?.threadId === "string"
          ? params.threadId
          : typeof record(params?.thread)?.id === "string"
            ? record(params?.thread)!.id
            : null;
      if (eventThreadId !== null && eventThreadId !== thread.threadId) continue;
      if (message?.method === "error") {
        throw new Error("The Codex provider reported an error during query projection.");
      }
      if (message?.method === "item/completed") {
        const item = record(params?.item);
        if (item?.type === "agentMessage" && typeof item.text === "string") content = item.text;
        else if (item?.type !== "userMessage" && item?.type !== "reasoning") {
          throw new Error("The Codex query projection emitted a capability-bearing item.");
        }
      }
      if (message?.method === "thread/tokenUsage/updated") usage = codexUsage(params ?? {});
      if (message?.method === "turn/completed" && record(params?.turn)?.id === providerTurnId) {
        if (record(params?.turn)?.status !== "completed") {
          throw new Error("The Codex query-projection turn did not complete.");
        }
        completed = true;
        break;
      }
    }
    if (!completed || content === null) {
      throw new Error("The Codex query-projection result is incomplete.");
    }
    return { value: parseProviderResultText(content, "Codex"), usage };
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", abort);
    if (providerTurnId !== undefined && controller.signal.aborted) {
      await input.client.interruptTurn(thread.threadId, providerTurnId).catch(() => undefined);
    }
    await input.client.unsubscribe(thread.threadId).catch(() => undefined);
  }
}

export async function createCodexPersistentQueryRunner(
  input: {
    model?: string;
    /** ADR-0612: the `background` role's effort; `low` as before when absent. */
    reasoningEffort?: ModelReasoningEffort;
    systemPrompt: string;
    timeoutMs: number;
  },
  dependencies: CodexPersistentQueryRunnerDependencies = defaultDependencies,
): Promise<{
  runner: NoCapabilityProviderJsonRunner;
  runtimeContract: "codex.persistent_isolated_thread.v1";
  close(): Promise<void>;
}> {
  const directory = await dependencies.createDirectory();
  let client: CodexQueryClient | undefined;
  try {
    await dependencies.assertNoModelTools({
      executable: "codex",
      cwd: directory,
      timeoutMs: input.timeoutMs,
    });
    client = await dependencies.connect({
      executable: "codex",
      commandArguments: [
        "app-server",
        "--stdio",
        "--strict-config",
        "-c",
        "mcp_servers={}",
        ...codexNoCapabilityFeatureArguments(),
      ],
      cwd: directory,
      requestTimeoutMs: input.timeoutMs,
    });
    const observed = async (value: unknown, signal?: AbortSignal) =>
      observedTurn({
        client: client!,
        cwd: directory,
        systemPrompt: input.systemPrompt,
        ...(input.model === undefined ? {} : { model: input.model }),
        reasoningEffort: input.reasoningEffort ?? "low",
        timeoutMs: input.timeoutMs,
        value,
        ...(signal === undefined ? {} : { signal }),
      });
    return {
      runner: {
        provider: "codex",
        resolve: async (value, signal) => (await observed(value, signal)).value,
        resolveObserved: observed,
      },
      runtimeContract: "codex.persistent_isolated_thread.v1",
      close: async () => {
        await client!.close();
        await dependencies.removeDirectory(directory);
      },
    };
  } catch (error) {
    await client?.close().catch(() => undefined);
    await dependencies.removeDirectory(directory);
    throw error;
  }
}

/** The request as the provider reads it: its response schema without reference-kind marks. */
function providerWireRequest(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const request = value as Record<string, unknown>;
  const contract = request.responseContract as Record<string, unknown> | undefined;
  if (contract === null || typeof contract !== "object" || !("schema" in contract)) return value;
  return {
    ...request,
    responseContract: { ...contract, schema: providerWireSchema(contract.schema) },
  };
}
