import type { AdapterDescriptor, ResourceAccountingDescriptor } from "@lervo/schemas";

import { CODEX_ADAPTER_ID, CODEX_ADAPTER_VERSION } from "./adapter-validation.js";
import type { CodexAdapterOptions } from "./types.js";

export function createCodexAdapterDescriptor(): AdapterDescriptor {
  return {
    kind: "descriptor",
    schemaVersion: 1,
    adapterId: CODEX_ADAPTER_ID,
    adapterVersion: CODEX_ADAPTER_VERSION,
    provider: "codex",
    capabilities: {
      controlledContextInjection: "supported",
      toolCalls: "supported",
      commandExecution: "supported",
      fileChanges: "supported",
      contextCompaction: "supported",
      sessionResume: "unsupported",
      usage: "supported",
    },
  };
}

export function requestedCodexModel(options: CodexAdapterOptions): string | null {
  return options.transport?.kind === "responses_api_no_tools"
    ? (options.transport.model ?? null)
    : (options.model ?? null);
}

export function createCodexResourceAccountingDescriptor(
  options: CodexAdapterOptions,
): ResourceAccountingDescriptor {
  return {
    kind: "resource_accounting_descriptor",
    schemaVersion: 2,
    provider: "codex",
    adapterId: CODEX_ADAPTER_ID,
    adapterVersion: CODEX_ADAPTER_VERSION,
    accountingMode: "turn_cumulative",
    observationSupport: "supported",
    unavailableReason: null,
    normalizationId: "codex_app_server_usage_v1",
    nativeCounterSemanticsId: "codex_turn_token_usage_cumulative_v1",
    requestedModel: requestedCodexModel(options),
    serviceTier: null,
  };
}
