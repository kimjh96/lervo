import { pauseKnowledgeProviderFailure } from "./provider-failure-pause.js";
import { admittedBackgroundContext, backgroundProviderOptions } from "./background-provider.js";
import { reserveConvergenceProviderCall } from "./provider-budget.js";
import {
  createNoCapabilityProviderJsonRunner,
  KnowledgeProviderAvailabilityError,
} from "@lervo/repository-knowledge-compiler";
import {
  canonicalJson,
  sha256,
  withProcessCostScope,
  type KnowledgeConvergenceInput,
} from "@lervo/repository-knowledge";

import { acquireKnowledgeProviderAdmission } from "./provider-admission.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import { recordKnowledgeWorkerMeasurement } from "./knowledge-worker-measurement.js";
import type { SemanticReviewContextDocument, ReviewContextSkip } from "./review-context.js";
import type { ConvergenceAssignmentAuthority } from "./workforce.js";
import type { ConvergenceRuntimeContext } from "./stage-context.js";
import { readProviderReviewCache, storeProviderReviewCache } from "./provider-review-cache.js";
import {
  abandonProviderCallOnUpgrade,
  upgradePreemptionError,
  upgradeWaiting,
} from "./upgrade-preemption.js";
import type { ProviderOutputSchema } from "@lervo/schemas";

export async function withKnowledgeProviderAdmission<T>(input: {
  context: ConvergenceRuntimeContext;
  state: KnowledgeConvergenceInput;
  authority: ConvergenceAssignmentAuthority;
  budget: { batchId: string; maximumCalls: number };
  /**
   * `endPolling` stops the source poll and waits for one in flight. A run that writes after its
   * provider call ends polling first, so no decision check can follow its exact fence.
   */
  run(observationHash: string, signal: AbortSignal, endPolling: () => Promise<void>): Promise<T>;
}): Promise<T> {
  const { context } = input;
  if (context.providerQuantum !== undefined && context.providerQuantum.remaining <= 0)
    throw new KnowledgeConvergenceRuntimeError("knowledge_capacity_unavailable");
  await input.authority.assertCurrent();
  context.assertSourceCurrent(input.state);
  const admission = await acquireKnowledgeProviderAdmission({
    repositoryRoot: context.storage.paths.repositoryRoot,
    provider: context.provider,
    liveWorkPending: context.liveWorkPending,
    ...(context.admissionDirectory === undefined ? {} : { directory: context.admissionDirectory }),
  });
  if (admission === null)
    throw new KnowledgeConvergenceRuntimeError("knowledge_capacity_unavailable");
  const controller = new AbortController();
  const abort = () => controller.abort(context.signal.reason);
  context.signal.addEventListener("abort", abort, { once: true });
  if (context.signal.aborted) abort();
  let polling: Promise<void> | null = null;
  const timer = setInterval(() => {
    if (polling !== null) return;
    polling = withProcessCostScope("provider_poll", () =>
      input.authority.assertCurrent().then(() => context.assertSourceCurrent(input.state)),
    )
      .catch((error: unknown) => controller.abort(error))
      .finally(() => {
        polling = null;
      });
  }, 1_000);
  timer.unref();
  let endUpgradeWatch = async (): Promise<void> => undefined;
  const endPolling = async () => {
    clearInterval(timer);
    await polling;
    await endUpgradeWatch();
  };
  try {
    await input.authority.assertCurrent();
    context.assertSourceCurrent(input.state);
    // ADR-0587: a waiting upgrade gets the host before this call starts or spends its budget.
    if (await upgradeWaiting(context)) throw upgradePreemptionError();
    await reserveConvergenceProviderCall({
      repositoryRoot: context.storage.paths.repositoryRoot,
      obligationId: input.state.obligationId,
      events: context.storage.events,
      ...input.budget,
    });
    if (context.providerQuantum !== undefined) context.providerQuantum.remaining -= 1;
    endUpgradeWatch = abandonProviderCallOnUpgrade(context, (reason) => controller.abort(reason));
    return await input.run(admission.observationHash, controller.signal, endPolling);
  } catch (error) {
    if (error instanceof KnowledgeProviderAvailabilityError)
      await pauseKnowledgeProviderFailure(context, error);
    if (controller.signal.aborted) {
      if (context.signal.aborted) throw new KnowledgeConvergenceRuntimeError("knowledge_cancelled");
      throw controller.signal.reason;
    }
    throw error;
  } finally {
    // Callers fence and write after this returns; no poll may still be in flight then.
    await endPolling();
    context.signal.removeEventListener("abort", abort);
    await admission.release();
  }
}

export async function reviewKnowledgeJson(input: {
  context: ConvergenceRuntimeContext;
  state: KnowledgeConvergenceInput;
  authority: ConvergenceAssignmentAuthority;
  budget: { batchId: string; maximumCalls: number };
  prompt: string;
  task: string;
  schema: ProviderOutputSchema;
  untrustedSourceData: unknown;
  /** The canonical review context Lervo loaded for this call; it forms the ADR-0459 receipt. */
  contextDocuments: readonly SemanticReviewContextDocument[];
  contextSkips?: readonly ReviewContextSkip[];
  /**
   * ADR-0604: the caller's own parser, which throws on an answer its contract rejects. Only an
   * accepted answer is cached, and a cached answer it rejects is asked for again, so an invalid
   * answer is never replayed.
   */
  accept: (value: unknown) => unknown;
  /**
   * ADR-0604: what the answer is bound to that the provider is not shown, such as an exact plan
   * hash. It is part of the cache key only, so an answer is replayed only for the same binding.
   */
  binding?: unknown;
}): Promise<{
  value: unknown;
  usage: unknown;
  admissionObservationHash: string;
  observationArtifactHash: string;
}> {
  input = { ...input, context: await admittedBackgroundContext(input.context) };
  await input.authority.assertCurrent();
  input.context.assertSourceCurrent(input.state);
  const cache = {
    root: input.context.storage.paths.repositoryRoot,
    artifacts: input.context.storage.artifacts,
    key: sha256(
      canonicalJson([
        input.context.provider,
        input.context.providerCliIdentityHash ?? null,
        input.state.obligationId,
        input.state.snapshotHash,
        input.state.baseline.delegationHash,
        input.state.stageData,
        input.task,
        input.prompt,
        input.schema,
        input.untrustedSourceData,
        input.contextDocuments,
        input.contextSkips ?? [],
        ...(input.binding === undefined ? [] : [input.binding]),
      ]),
    ),
  };
  const prior = (await readProviderReviewCache(cache)) as {
    value: unknown;
    usage: unknown;
    admissionObservationHash: string;
    observationArtifactHash: string;
  } | null;
  if (
    prior !== null &&
    typeof prior.admissionObservationHash === "string" &&
    typeof prior.observationArtifactHash === "string" &&
    accepted(input.accept, prior.value)
  )
    return prior;
  const result = await withKnowledgeProviderAdmission({
    ...input,
    run: async (admissionObservationHash, signal, endPolling) => {
      const runner = await createNoCapabilityProviderJsonRunner({
        ...backgroundProviderOptions(input.context),
        systemPrompt: input.prompt,
        timeoutMs: 300_000,
      });
      if (runner.resolveObserved === undefined)
        throw new KnowledgeConvergenceRuntimeError("knowledge_usage_unavailable");
      const result = await runner.resolveObserved(
        {
          schemaVersion: 1,
          task: input.task,
          responseContract: { schemaVersion: 1, schema: input.schema },
          untrustedSourceData: input.untrustedSourceData,
        },
        signal,
      );
      if (result.usage === null)
        throw new KnowledgeConvergenceRuntimeError("knowledge_usage_unavailable");
      await endPolling();
      // A poll that saw a change aborted the call; its effects must not follow.
      if (signal.aborted) throw signal.reason;
      await input.authority.assertCurrent();
      // The observation artifact, the usage event and the review cache follow: exact.
      input.context.assertSourceExact(input.state);
      const proof = await input.context.storage.artifacts.put(
        canonicalJson({
          schemaVersion: 1,
          kind: "provider_stage_observation",
          assignmentId: input.authority.assignment.assignmentId,
          inputArtifactHash: sha256(canonicalJson(input.state)),
          task: input.task,
          value: result.value,
          usage: result.usage,
          admissionObservationHash,
          contextSkips: input.contextSkips ?? [],
        }),
      );
      await recordKnowledgeWorkerMeasurement({
        context: input.context,
        agentId: input.authority.agent.agentId,
        task: input.task,
        snapshotHash: input.state.snapshotHash,
        observationArtifactHash: proof.contentHash,
        admissionObservationHash,
        usage: result.usage,
        contextDocuments: input.contextDocuments,
        occurredAt: new Date().toISOString(),
      });
      return { ...result, admissionObservationHash, observationArtifactHash: proof.contentHash };
    },
  });
  // The caller still parses and reports an invalid answer; it is only never kept for a replay.
  if (accepted(input.accept, result.value))
    await storeProviderReviewCache({ ...cache, value: result });
  return result;
}

function accepted(accept: (value: unknown) => unknown, value: unknown): boolean {
  try {
    accept(value);
    return true;
  } catch {
    return false;
  }
}
