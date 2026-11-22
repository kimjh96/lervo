import { compileFailure } from "./compiler-failure.js";
import { parseClaudeOutput, parseCodexOutput } from "./provider-response.js";
export { parseClaudeOutput, parseProviderResultText } from "./provider-response.js";
import {
  providerResponseContractSchema,
  providerNativeResponseSchema,
} from "./provider-response-schema.js";
export {
  providerResponseContractSchema,
  providerNativeResponseSchema,
} from "./provider-response-schema.js";
import { codexNoCapabilityFeatureArguments } from "./codex-capability-probe.js";
export {
  CODEX_NO_CAPABILITY_DISABLED_FEATURES,
  codexNoCapabilityFeatureArguments,
  assertCodexHasNoModelTools,
} from "./codex-capability-probe.js";
import {
  claudeJsonUsage,
  codexJsonUsage,
  documentNormalizationTokenUsage,
} from "./provider-json-usage.js";
import {
  documentNormalizationResponseSchema,
  documentNormalizationInstruction,
  documentNormalizationFeedbackInstruction,
  documentNormalizationPromptInstruction,
} from "./process-compiler-contract.js";
import {
  claudeNoCapabilityArguments,
  codexNoCapabilityArguments,
} from "./no-capability-arguments.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  canonicalJson,
  sha256,
  type DocumentNormalizationResponse,
  type RepositoryDocumentNormalizationCompiler,
  assertProviderOutputSchemaForSource,
  assertProviderPromptAsksNoHashCopy,
  providerWireSchema,
} from "@lervo/repository-knowledge";

import type {
  CreateProcessProviderOptions,
  NoCapabilityProviderJsonRunner,
  NoCapabilityTelemetry,
} from "./process-provider-contract.js";
export type {
  CreateProcessProviderOptions,
  NoCapabilityProviderJsonRunner,
  ProviderJsonRequest,
  ProviderJsonUsage,
} from "./process-provider-contract.js";
import { runNoCapabilityProcess } from "./provider-invocation-call.js";
import {
  prepareNoCapabilityInvocation,
  providerInvocationContract,
} from "./provider-invocation-preflight.js";

const NORMALIZATION_ADAPTER_VERSION = "3";
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

/**
 * Runs one provider turn with the no-tool provider boundary. The caller owns the response schema and validation;
 * this runner only proves the provider/isolation boundary and returns JSON.
 */
export async function createNoCapabilityProviderJsonRunner(
  options: CreateProcessProviderOptions,
): Promise<NoCapabilityProviderJsonRunner> {
  if (
    options.systemPrompt !== undefined &&
    (options.systemPrompt.trim() !== options.systemPrompt ||
      options.systemPrompt.length === 0 ||
      options.systemPrompt.length > 8_192)
  ) {
    throw compileFailure("The provider JSON runner system prompt is invalid.");
  }
  const { executable, timeoutMs } = await prepareNoCapabilityInvocation(options);
  const resolveObserved = async (input: unknown, signal?: AbortSignal) => {
    const directory = await mkdtemp(resolve(tmpdir(), `lervo-${options.provider}-json-`));
    try {
      const prompt = canonicalJson(providerWireRequest(input));
      const responseContractSchema = providerResponseContractSchema(input);
      // ADR-0608: the schema crossed into this process as JSON, without its brand, so it is
      // checked whole, and against this request's own data, before it leaves for the provider.
      try {
        assertProviderOutputSchemaForSource(responseContractSchema, {
          ...(input as Record<string, unknown>),
          responseContract: null,
        });
        assertProviderPromptAsksNoHashCopy(options.systemPrompt ?? "", ...lervoAuthoredText(input));
      } catch (error) {
        throw compileFailure(
          `The provider JSON runner response schema copies source data: ${(error as Error).message}`,
        );
      }
      // Checked above as built; the provider receives it without reference-kind marks.
      const wireSchema = providerWireSchema(responseContractSchema);
      const responseSchema =
        options.provider === "codex" ? providerNativeResponseSchema(wireSchema) : wireSchema;
      const responseSchemaJson = canonicalJson(responseSchema);
      const codexResponseSchemaPath = resolve(directory, "response-schema.json");
      if (options.provider === "codex") {
        await writeFile(codexResponseSchemaPath, `${responseSchemaJson}\n`, {
          encoding: "utf8",
          mode: 0o600,
          flag: "wx",
        });
      }
      const arguments_ =
        options.provider === "claude"
          ? [
              ...claudeNoCapabilityArguments(),
              "--effort",
              options.reasoningEffort ?? "low",
              ...(options.systemPrompt === undefined
                ? []
                : ["--system-prompt", options.systemPrompt]),
              "--json-schema",
              responseSchemaJson,
              ...(options.model === undefined ? [] : ["--model", options.model]),
            ]
          : [
              ...codexNoCapabilityArguments(),
              "-c",
              `model_reasoning_effort="${options.reasoningEffort ?? "low"}"`,
              ...(options.systemPrompt === undefined
                ? []
                : ["-c", `developer_instructions=${JSON.stringify(options.systemPrompt)}`]),
              "--output-schema",
              codexResponseSchemaPath,
              ...codexNoCapabilityFeatureArguments(),
              ...(options.model === undefined ? [] : ["--model", options.model]),
              "-",
            ];

      const result = await runNoCapabilityProcess(options, {
        executable,
        arguments: arguments_,
        cwd: directory,
        stdin: prompt,
        ...(signal === undefined ? {} : { signal }),
        timeoutMs,
        maxOutputBytes: MAX_OUTPUT_BYTES,
      });
      if (result.status !== "completed") {
        throw Object.assign(
          compileFailure(`The provider JSON runner did not complete (${result.status}).`),
          { processStatus: result.status },
        );
      }
      const observed =
        options.provider === "claude"
          ? parseClaudeOutput<Record<string, unknown> & { telemetry: NoCapabilityTelemetry }>(
              result.stdout,
              { structuredOutputRequired: true },
            )
          : parseCodexOutput<Record<string, unknown> & { telemetry: NoCapabilityTelemetry }>(
              result.stdout,
            );
      const { telemetry: _telemetry, ...value } = observed;
      return {
        value,
        usage:
          options.provider === "claude"
            ? claudeJsonUsage(result.stdout)
            : codexJsonUsage(result.stdout),
      };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  };
  return {
    provider: options.provider,
    resolve: async (input, signal) => (await resolveObserved(input, signal)).value,
    resolveObserved,
  };
}

export async function createProcessDocumentNormalizationCompiler(
  options: CreateProcessProviderOptions,
): Promise<RepositoryDocumentNormalizationCompiler> {
  const { executable, timeoutMs, version } = await prepareNoCapabilityInvocation(options);
  const invocationContract = {
    adapter: `lervo-process-document-normalizer@${NORMALIZATION_ADAPTER_VERSION}`,
    ...providerInvocationContract(options, version),
    compilerInstructionHash: sha256(documentNormalizationInstruction),
    reviewFeedbackInstructionHash: sha256(documentNormalizationFeedbackInstruction),
    responseSchemaHash: sha256(canonicalJson(documentNormalizationResponseSchema)),
  };
  const descriptor = {
    compilerId: `lervo.${options.provider}.document-normalizer`,
    compilerVersion: `${NORMALIZATION_ADAPTER_VERSION}+${version}`,
    compilerBuildId: sha256(canonicalJson(invocationContract)),
    provider: options.provider,
    isolation: "external_no_capabilities" as const,
  };
  const normalizeObserved: NonNullable<
    RepositoryDocumentNormalizationCompiler["normalizeObserved"]
  > = async (envelope, signal) => {
    const directory = await mkdtemp(resolve(tmpdir(), `lervo-${options.provider}-normalization-`));
    try {
      const instruction = documentNormalizationPromptInstruction(envelope);
      // ADR-0608: the normalization call is checked like every other, against its own envelope.
      try {
        assertProviderOutputSchemaForSource(documentNormalizationResponseSchema, envelope);
        assertProviderPromptAsksNoHashCopy(documentNormalizationInstruction, instruction);
      } catch (error) {
        throw compileFailure(
          `The document normalization response schema copies source data: ${(error as Error).message}`,
        );
      }
      const prompt = canonicalJson({
        instruction,
        responseSchema: providerWireSchema(documentNormalizationResponseSchema),
        envelope,
      });
      const responseSchemaJson = canonicalJson(
        providerNativeResponseSchema(providerWireSchema(documentNormalizationResponseSchema)),
      );
      const codexResponseSchemaPath = resolve(directory, "response-schema.json");
      if (options.provider === "codex")
        await writeFile(codexResponseSchemaPath, `${responseSchemaJson}\n`, {
          encoding: "utf8",
          mode: 0o600,
          flag: "wx",
        });
      const arguments_ =
        options.provider === "claude"
          ? [
              ...claudeNoCapabilityArguments(),
              "--json-schema",
              responseSchemaJson,
              "--system-prompt",
              documentNormalizationInstruction,
              ...(options.model === undefined ? [] : ["--model", options.model]),
            ]
          : [
              ...codexNoCapabilityArguments(),
              "--output-schema",
              codexResponseSchemaPath,
              ...codexNoCapabilityFeatureArguments(),
              ...(options.model === undefined ? [] : ["--model", options.model]),
              "-",
            ];

      const result = await runNoCapabilityProcess(options, {
        executable,
        arguments: arguments_,
        cwd: directory,
        stdin: prompt,
        signal,
        timeoutMs,
        maxOutputBytes: MAX_OUTPUT_BYTES,
      });
      if (result.status === "cancelled")
        throw signal.reason ?? compileFailure("Document normalization was cancelled.");
      if (result.status !== "completed")
        throw Object.assign(
          compileFailure(`The document normalizer process did not complete (${result.status}).`),
          { processStatus: result.status },
        );
      const response =
        options.provider === "claude"
          ? parseClaudeOutput<DocumentNormalizationResponse>(result.stdout, {
              structuredOutputRequired: true,
            })
          : parseCodexOutput<DocumentNormalizationResponse>(result.stdout);
      const usage =
        options.provider === "claude"
          ? claudeJsonUsage(result.stdout)
          : codexJsonUsage(result.stdout);
      return { response, tokenUsage: documentNormalizationTokenUsage(usage) };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  };
  return {
    descriptor,
    normalize: async (envelope, signal) => (await normalizeObserved(envelope, signal)).response,
    normalizeObserved,
  };
}

export const documentNormalizationProviderResponseSchema = documentNormalizationResponseSchema;

/**
 * ADR-0608: the request's own words, which Lervo wrote: every string field outside the response
 * contract and the untrusted data a request carries.
 */
function lervoAuthoredText(input: unknown): string[] {
  if (input === null || typeof input !== "object") return [];
  return Object.entries(input as Record<string, unknown>)
    .filter(([key, value]) => typeof value === "string" && !/^untrusted/iu.test(key))
    .map(([, value]) => value as string);
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
