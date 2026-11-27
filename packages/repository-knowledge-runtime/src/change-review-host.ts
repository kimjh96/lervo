import { admittedBackgroundContext, backgroundProviderOptions } from "./background-provider.js";
import { noCapabilityJsonInvocationStrategy } from "./no-capability-json-strategy.js";
import {
  RepositoryKnowledgeReviewError,
  type RepositoryKnowledgeWorkerHost,
} from "@lervo/repository-knowledge";
import {
  createNoCapabilityKnowledgeReviewHost,
  KnowledgeProviderAvailabilityError,
  noCapabilityReviewAccountingDescriptor,
  type KnowledgeReviewCallGovernor,
} from "@lervo/repository-knowledge-compiler";
import type { ProjectStorage } from "@lervo/project-storage";

import { recordChangeReviewUsage } from "./change-review-usage.js";
import { loadConvergenceDelegation } from "./delegation.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import { acquireKnowledgeProviderAdmission, pauseKnowledgeProvider } from "./provider-admission.js";
import { reserveConvergenceProviderCall } from "./provider-budget.js";
import {
  abandonProviderCallOnUpgrade,
  upgradePreemptionError,
  upgradeWaiting,
  type UpgradePreemptionSource,
} from "./upgrade-preemption.js";

/** `yieldToUpgrade` lets a resident abandon a review call for a waiting upgrade (ADR-0587). */
export interface ChangeReviewHostInput extends UpgradePreemptionSource {
  storage: ProjectStorage;
  provider: "codex" | "claude";
  executable?: string;
  admissionDirectory?: string;
  signal: AbortSignal;
  liveWorkPending(): Promise<boolean>;
  now?: () => Date;
}

/** Background review spend needs the reviewed delegation; its absence grants inspection only. */
export async function knowledgeReviewCallCeiling(
  input: Pick<ChangeReviewHostInput, "storage" | "provider" | "now">,
): Promise<number> {
  let loaded: Awaited<ReturnType<typeof loadConvergenceDelegation>>;
  try {
    loaded = await loadConvergenceDelegation(input.storage.paths.repositoryRoot);
  } catch (error) {
    throw new RepositoryKnowledgeReviewError("knowledge_authority_unavailable", { cause: error });
  }
  const now = (input.now ?? (() => new Date()))().getTime();
  if (
    loaded === null ||
    loaded.delegation.state !== "active" ||
    loaded.delegation.projectId !== input.storage.manifest.projectId ||
    Date.parse(loaded.delegation.expiresAt) <= now ||
    !loaded.delegation.providers.includes(input.provider)
  )
    throw new RepositoryKnowledgeReviewError("knowledge_authority_unavailable");
  return loaded.delegation.resourceCeilings.maximumProviderCalls;
}

/**
 * Governs each per-change review call through the shared v4 provider admission, the per-job call
 * budget, and `resource.usage.recorded` measurement. Authority, budget, pause, and missing usage
 * are terminal attention; capacity contention and process failures stay transient, bounded by the
 * same call budget across retries.
 */
export function governChangeReviewCalls(input: ChangeReviewHostInput): KnowledgeReviewCallGovernor {
  const root = input.storage.paths.repositoryRoot;
  const descriptor = noCapabilityReviewAccountingDescriptor(
    noCapabilityJsonInvocationStrategy(input.provider),
  );
  const occurredAt = () => (input.now ?? (() => new Date()))().toISOString();
  return async (job, call) => {
    const maximumCalls = await knowledgeReviewCallCeiling(input);
    let admission: Awaited<ReturnType<typeof acquireKnowledgeProviderAdmission>>;
    try {
      admission = await acquireKnowledgeProviderAdmission({
        repositoryRoot: root,
        provider: input.provider,
        liveWorkPending: input.liveWorkPending,
        ...(input.admissionDirectory === undefined ? {} : { directory: input.admissionDirectory }),
      });
    } catch (error) {
      if ((error as { code?: unknown }).code === "knowledge_provider_paused")
        throw new RepositoryKnowledgeReviewError("knowledge_provider_paused", { cause: error });
      throw error;
    }
    if (admission === null)
      throw new KnowledgeConvergenceRuntimeError("knowledge_capacity_unavailable");
    try {
      // ADR-0587: a waiting upgrade gets the host before this call starts or spends its budget.
      if (await upgradeWaiting(input)) throw upgradePreemptionError();
      let callOrdinal: number;
      try {
        callOrdinal = await reserveConvergenceProviderCall({
          repositoryRoot: root,
          obligationId: job.resolutionEventId,
          events: input.storage.events,
          batchId: `repository-change-review\0${job.changeEventId}\0${job.destinationId}`,
          maximumCalls,
        });
      } catch (error) {
        if ((error as { code?: unknown }).code === "normalization_budget_exceeded")
          throw new RepositoryKnowledgeReviewError("knowledge_review_budget_exhausted", {
            cause: error,
          });
        throw error;
      }
      const record = (
        usage: Parameters<typeof recordChangeReviewUsage>[0]["usage"],
        reasonCode: string | null,
      ) =>
        recordChangeReviewUsage({
          events: input.storage.events,
          artifacts: input.storage.artifacts,
          job,
          callOrdinal,
          descriptor,
          usage,
          reasonCode,
          occurredAt: occurredAt(),
        });
      let result: Awaited<ReturnType<Parameters<KnowledgeReviewCallGovernor>[1]>>;
      const preemption = new AbortController();
      const endUpgradeWatch = abandonProviderCallOnUpgrade(input, (reason) =>
        preemption.abort(reason),
      );
      try {
        result = await call(AbortSignal.any([input.signal, preemption.signal]));
      } catch (error) {
        const abandoned = preemption.signal.aborted && !input.signal.aborted;
        await endUpgradeWatch();
        await record(null, "knowledge_provider_call_failed");
        if (error instanceof KnowledgeProviderAvailabilityError) {
          await pauseKnowledgeProvider({
            provider: input.provider,
            reason: error.reason,
            observationHash: error.observationHash,
            resetAt: error.resetAt,
            ...(input.admissionDirectory === undefined
              ? {}
              : { directory: input.admissionDirectory }),
          });
          throw new RepositoryKnowledgeReviewError("knowledge_provider_paused", { cause: error });
        }
        // ADR-0587: the abandoned answer is discarded; the job retries after the upgrade.
        if (abandoned) throw upgradePreemptionError({ cause: error });
        throw error;
      } finally {
        await endUpgradeWatch();
      }
      if ((await record(result.usage, null)) !== "observed")
        throw new RepositoryKnowledgeReviewError("knowledge_usage_unavailable");
      return result.value;
    } finally {
      await admission.release();
    }
  };
}

/** The v4 per-change reviewer: the shared no-capability adapter under v4 governance. */
export function createChangeReviewHost(
  input: ChangeReviewHostInput,
): RepositoryKnowledgeWorkerHost {
  let active = createNoCapabilityKnowledgeReviewHost(
    input.storage.paths.repositoryRoot,
    noCapabilityJsonInvocationStrategy(input.provider),
  );
  return {
    inspectKnowledge: () => active.inspectKnowledge(),
    assertReviewContextCurrent: () => active.assertReviewContextCurrent?.(),
    review: async (sources, job) => {
      // Missing delegation stays terminal attention for the review, as the call ceiling reports it.
      const selected = await admittedBackgroundContext(input).catch((error: unknown) => {
        if (
          error instanceof KnowledgeConvergenceRuntimeError &&
          error.code === "knowledge_authority_unavailable"
        )
          throw new RepositoryKnowledgeReviewError("knowledge_authority_unavailable", {
            cause: error,
          });
        throw error;
      });
      active = createNoCapabilityKnowledgeReviewHost(
        input.storage.paths.repositoryRoot,
        noCapabilityJsonInvocationStrategy(selected.provider),
        selected.executable,
        governChangeReviewCalls(selected),
        backgroundProviderOptions(selected),
      );
      return active.review(sources, job);
    },
  };
}
