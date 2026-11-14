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

export async function withKnowledgeProviderAdmission<T>(input: {
  context: ConvergenceRuntimeContext;
  state: KnowledgeConvergenceInput;
  authority: ConvergenceAssignmentAuthority;
  budget: { batchId: string; maximumCalls: number };
  run(observationHash: string, signal: AbortSignal): Promise<T>;
}): Promise<T> {
  const { context } = input;
  if (context.providerQuantum !== undefined && context.providerQuantum.remaining <= 0)
    throw new KnowledgeConvergenceRuntimeError("knowledge_capacity_unavailable");
  await input.authority.assertCurrent();
  context.assertSource(input.state);
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
  let observing = false;
  const timer = setInterval(() => {
    if (observing) return;
    observing = true;
    void withProcessCostScope("provider_poll", () =>
      input.authority.assertCurrent().then(() => context.assertSource(input.state)),
    )
      .catch((error: unknown) => controller.abort(error))
      .finally(() => {
        observing = false;
      });
  }, 1_000);
  timer.unref();
  try {
    await input.authority.assertCurrent();
    context.assertSource(input.state);
    await reserveConvergenceProviderCall({
      repositoryRoot: context.storage.paths.repositoryRoot,
      obligationId: input.state.obligationId,
      events: context.storage.events,
      ...input.budget,
    });
    if (context.providerQuantum !== undefined) context.providerQuantum.remaining -= 1;
    return await input.run(admission.observationHash, controller.signal);
  } catch (error) {
    if (error instanceof KnowledgeProviderAvailabilityError)
      await pauseKnowledgeProviderFailure(context, error);
    if (controller.signal.aborted) {
      if (context.signal.aborted) throw new KnowledgeConvergenceRuntimeError("knowledge_cancelled");
      throw controller.signal.reason;
    }
    throw error;
  } finally {
    clearInterval(timer);
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
  schema: unknown;
  untrustedSourceData: unknown;
  /** The canonical review context Lervo loaded for this call; it forms the ADR-0459 receipt. */
  contextDocuments: readonly SemanticReviewContextDocument[];
  contextSkips?: readonly ReviewContextSkip[];
}): Promise<{
  value: unknown;
  usage: unknown;
  admissionObservationHash: string;
  observationArtifactHash: string;
}> {
  input = { ...input, context: await admittedBackgroundContext(input.context) };
  await input.authority.assertCurrent();
  input.context.assertSource(input.state);
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
    typeof prior.observationArtifactHash === "string"
  )
    return prior;
  const result = await withKnowledgeProviderAdmission({
    ...input,
    run: async (admissionObservationHash, signal) => {
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
      await input.authority.assertCurrent();
      input.context.assertSource(input.state);
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
  await storeProviderReviewCache({ ...cache, value: result });
  return result;
}
