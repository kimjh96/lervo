import type { NoCapabilityJsonInvocationStrategy } from "@lervo/adapter-contract";
import type { RepositoryKnowledgeReviewJob } from "@lervo/repository-knowledge";

import type { ProviderJsonUsage } from "./process-compiler.js";

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
export function noCapabilityReviewAccountingDescriptor(
  strategy: Pick<NoCapabilityJsonInvocationStrategy, "provider" | "usageSemanticsId">,
) {
  const provider = strategy.provider;
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
    nativeCounterSemanticsId: strategy.usageSemanticsId,
    requestedModel: null,
    serviceTier: null,
  };
}
