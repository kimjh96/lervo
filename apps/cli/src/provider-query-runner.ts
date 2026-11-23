import { canonicalJson, sha256 } from "@lervo/repository-knowledge";
import {
  createNoCapabilityProviderJsonRunner,
  type NoCapabilityProviderJsonRunner,
  type ProviderJsonUsage,
  type ProviderJsonRequest,
} from "@lervo/repository-knowledge-compiler";

import type { RunProvider } from "./managed-run.js";
import { modelRouteFor } from "@lervo/execution-contract";
import { readHostSelection, type ReadModelSelection } from "./model-role-routes.js";
import { createCodexPersistentQueryRunner } from "./provider-query-runner-codex.js";
import { providerOutputSchema } from "@lervo/schemas";

const admissionSchema = providerOutputSchema({
  type: "object",
  additionalProperties: false,
  properties: {
    schemaVersion: { const: 1 },
    retrievalQueries: {
      type: "array",
      maxItems: 1,
      items: { type: "string", minLength: 1, maxLength: 64 },
    },
  },
  required: ["schemaVersion", "retrievalQueries"],
} as const);

const admissionInput = {
  instruction: "Return one bounded diagnostic retrieval query using the response contract.",
  responseContract: {
    schemaVersion: 1,
    schema: admissionSchema,
    rawRequestOrKeywordFieldsForbidden: true,
  },
  requestedLanguage: "en",
  maximumGeneratedQueries: 1,
  requestDigest: sha256("lervo.provider-query-runner.admission.v1"),
  untrustedRequest: "repository retrieval readiness",
  boundedContext: { contextRequirement: "none" },
} as const satisfies ProviderJsonRequest;

export interface ProviderQueryRunnerAdmission {
  schemaVersion: 1;
  admissionId: string;
  provider: RunProvider;
  strategy: "persistent_isolated_thread_admission" | "serialized_process_admission";
  status: "ready";
  durationMs: number;
  usage: ProviderJsonUsage;
  privacy: {
    requestText: "excluded";
    responseText: "excluded";
    providerOutput: "excluded";
  };
}

export interface PreparedProviderQueryRunner {
  runner: NoCapabilityProviderJsonRunner;
  admission: ProviderQueryRunnerAdmission;
  runtimeContract:
    "codex.persistent_isolated_thread_admission.v3" | "claude.serialized_process_admission.v2";
  close(): Promise<void>;
}

export interface PreparedDirectProviderQueryRunner {
  runner: NoCapabilityProviderJsonRunner;
  runtimeContract:
    "codex.persistent_isolated_thread_direct.v1" | "claude.serialized_process_direct.v1";
  close(): Promise<void>;
}

export interface ProviderQueryRunnerDependencies {
  createCodexRunner: typeof createCodexPersistentQueryRunner;
  createSerializedRunner: typeof createNoCapabilityProviderJsonRunner;
  readSelection?: ReadModelSelection;
}

const defaultDependencies: ProviderQueryRunnerDependencies = {
  createCodexRunner: createCodexPersistentQueryRunner,
  createSerializedRunner: createNoCapabilityProviderJsonRunner,
};

interface OpenedProviderQueryRunner {
  runner: NoCapabilityProviderJsonRunner;
  close(): Promise<void>;
}

async function openProviderQueryRunner(
  provider: RunProvider,
  options: {
    model?: string;
    systemPrompt: string;
    timeoutMs: number;
  },
  dependencies: ProviderQueryRunnerDependencies,
): Promise<OpenedProviderQueryRunner> {
  // ADR-0612: queries are background work, so the `background` route for this provider sets the
  // model and effort; an unset role keeps the provider default model and effort `low`, as before.
  const route = modelRouteFor(
    await (dependencies.readSelection ?? readHostSelection)(),
    "background",
    provider,
  );
  const model = options.model ?? route.model ?? undefined;
  const routed = {
    ...(model === undefined ? {} : { model }),
    ...(route.reasoningEffort === null ? {} : { reasoningEffort: route.reasoningEffort }),
  };
  if (provider === "codex") {
    const prepared = await dependencies.createCodexRunner({
      ...routed,
      systemPrompt: options.systemPrompt,
      timeoutMs: options.timeoutMs,
    });
    return { runner: prepared.runner, close: prepared.close };
  }
  return {
    runner: await dependencies.createSerializedRunner({
      provider,
      ...routed,
      systemPrompt: options.systemPrompt,
      timeoutMs: options.timeoutMs,
    }),
    close: async () => undefined,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function admissionBody(value: unknown): void {
  const body = record(value);
  if (
    body === null ||
    body.schemaVersion !== 1 ||
    !Array.isArray(body.retrievalQueries) ||
    body.retrievalQueries.length !== 1 ||
    body.retrievalQueries.some((item) => typeof item !== "string" || item.length === 0)
  ) {
    throw new Error("The provider query-runner admission response is invalid.");
  }
}

function admissionReceipt(input: {
  provider: RunProvider;
  strategy: ProviderQueryRunnerAdmission["strategy"];
  durationMs: number;
  usage: ProviderJsonUsage | null;
}): ProviderQueryRunnerAdmission {
  if (input.usage === null) {
    throw new Error("The provider query-runner admission did not report complete usage.");
  }
  const core = {
    schemaVersion: 1 as const,
    provider: input.provider,
    strategy: input.strategy,
    status: "ready" as const,
    durationMs: input.durationMs,
    usage: input.usage,
    privacy: {
      requestText: "excluded" as const,
      responseText: "excluded" as const,
      providerOutput: "excluded" as const,
    },
  };
  return {
    ...core,
    admissionId: `pqadm_${sha256(canonicalJson(core)).slice("sha256:".length, 24 + "sha256:".length)}`,
  };
}

export async function prepareProviderQueryRunner(
  provider: RunProvider,
  options: {
    model?: string;
    systemPrompt: string;
    timeoutMs: number;
    now?: () => number;
  },
  dependencies: ProviderQueryRunnerDependencies = defaultDependencies,
): Promise<PreparedProviderQueryRunner> {
  const now = options.now ?? Date.now;
  const prepared = await openProviderQueryRunner(provider, options, dependencies);
  const runner = prepared.runner;
  const startedAt = now();
  try {
    const admission =
      runner.resolveObserved === undefined
        ? { value: await runner.resolve(admissionInput), usage: null }
        : await runner.resolveObserved(admissionInput);
    admissionBody(admission.value);
    return {
      runner,
      admission: admissionReceipt({
        provider,
        strategy:
          provider === "codex"
            ? "persistent_isolated_thread_admission"
            : "serialized_process_admission",
        durationMs: now() - startedAt,
        usage: admission.usage,
      }),
      runtimeContract:
        provider === "codex"
          ? "codex.persistent_isolated_thread_admission.v3"
          : "claude.serialized_process_admission.v2",
      close: prepared.close,
    };
  } catch (error) {
    await prepared.close().catch(() => undefined);
    throw error;
  }
}

export async function prepareDirectProviderQueryRunner(
  provider: RunProvider,
  options: {
    model?: string;
    systemPrompt: string;
    timeoutMs: number;
  },
  dependencies: ProviderQueryRunnerDependencies = defaultDependencies,
): Promise<PreparedDirectProviderQueryRunner> {
  const prepared = await openProviderQueryRunner(provider, options, dependencies);
  return {
    runner: prepared.runner,
    runtimeContract:
      provider === "codex"
        ? "codex.persistent_isolated_thread_direct.v1"
        : "claude.serialized_process_direct.v1",
    close: prepared.close,
  };
}
