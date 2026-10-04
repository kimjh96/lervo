import type { RepositoryKnowledgeReviewJob } from "@lervo/repository-knowledge";

import type { ProviderJsonUsage } from "./process-compiler.js";

export type KnowledgeReviewProvider = "claude" | "codex";

/** One adapter-performed review call; its result carries normalized usage, never native output. */
export type KnowledgeReviewCall = (
  signal: AbortSignal,
) => Promise<{ value: unknown; usage: ProviderJsonUsage | null }>;

/**
 * Wraps each review call with an owner's admission, budget, and measurement. The adapter performs
 * the provider call, so the governor stays provider-neutral.
 */
export type KnowledgeReviewCallGovernor = (
  job: RepositoryKnowledgeReviewJob,
  call: KnowledgeReviewCall,
) => Promise<unknown>;

/**
 * How the no-capability JSON adapter reports usage: one provider-reported total per call. A
 * provider-neutral owner records `resource.usage.recorded` against this descriptor (ADR-0459).
 */
export function noCapabilityReviewAccountingDescriptor(provider: KnowledgeReviewProvider) {
  return {
    kind: "resource_accounting_descriptor" as const,
    schemaVersion: 2 as const,
    provider,
    adapterId: `${provider}/no-capability-json`,
    adapterVersion: "1",
    accountingMode: "operation_delta" as const,
    observationSupport: "supported" as const,
    unavailableReason: null,
    normalizationId: `${provider}.no-capability-json.usage.v1`,
    nativeCounterSemanticsId:
      provider === "claude" ? "claude.print-json.model-usage.v1" : "codex.exec-json.turn-usage.v1",
    requestedModel: null,
    serviceTier: null,
  };
}
