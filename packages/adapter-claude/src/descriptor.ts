import type { AdapterDescriptor, ResourceAccountingDescriptor } from "@lervo/schemas";

import { CLAUDE_ADAPTER_ID, CLAUDE_ADAPTER_VERSION } from "./adapter-validation.js";
import type { ClaudeAdapterOptions } from "./types.js";

export function createClaudeAdapterDescriptor(): AdapterDescriptor {
  return {
    kind: "descriptor",
    schemaVersion: 1,
    adapterId: CLAUDE_ADAPTER_ID,
    adapterVersion: CLAUDE_ADAPTER_VERSION,
    provider: "claude",
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

export function createClaudeResourceAccountingDescriptor(
  options: ClaudeAdapterOptions,
): ResourceAccountingDescriptor {
  return {
    kind: "resource_accounting_descriptor",
    schemaVersion: 2,
    provider: "claude",
    adapterId: CLAUDE_ADAPTER_ID,
    adapterVersion: CLAUDE_ADAPTER_VERSION,
    accountingMode: "turn_cumulative",
    observationSupport: "supported",
    unavailableReason: null,
    normalizationId: "claude_sdk_usage_v1",
    nativeCounterSemanticsId: "claude_message_model_usage_cumulative_v1",
    requestedModel: options.model ?? null,
    serviceTier: null,
  };
}
