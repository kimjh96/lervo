import { canonicalJson, sha256 } from "@lervo/repository-knowledge";
import {
  createNoCapabilityProviderJsonRunner,
  type NoCapabilityProviderJsonRunner,
  type ProviderJsonUsage,
} from "@lervo/repository-knowledge-compiler";

import type { RunProvider } from "./managed-run.js";
import { createCodexPersistentQueryRunner } from "./provider-query-runner-codex.js";

const admissionSchema = {
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
} as const;

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
} as const;

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
): Promise<PreparedProviderQueryRunner> {
  const now = options.now ?? Date.now;
  const prepared =
    provider === "codex"
      ? await createCodexPersistentQueryRunner(options)
      : {
          runner: await createNoCapabilityProviderJsonRunner({
            provider,
            ...(options.model === undefined ? {} : { model: options.model }),
            systemPrompt: options.systemPrompt,
            timeoutMs: options.timeoutMs,
          }),
          runtimeContract: "claude.serialized_process_admission.v2" as const,
          close: async () => undefined,
        };
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
      runtimeContract: prepared.runtimeContract,
      close: prepared.close,
    };
  } catch (error) {
    await prepared.close().catch(() => undefined);
    throw error;
  }
}
