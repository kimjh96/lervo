import { pauseKnowledgeProviderFailure } from "./provider-failure-pause.js";
import { assertConvergenceDelegation, loadConvergenceDelegation } from "./delegation.js";
import { reserveConvergenceProviderCall } from "./provider-budget.js";
import { listAssignments } from "@lervo/agent-workforce";
import { hasCurrentForegroundLease } from "./foreground-admission.js";
import type { RepositoryDocumentNormalizationCompiler } from "@lervo/repository-knowledge";
import {
  createProcessDocumentNormalizationCompiler,
  KnowledgeProviderAvailabilityError,
} from "@lervo/repository-knowledge-compiler";
import {
  admittedBackgroundContext,
  backgroundProviderOptions,
  type BackgroundProviderContext,
} from "./background-provider.js";
import { acquireKnowledgeProviderAdmission } from "./provider-admission.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";

/** Legacy Node generation uses the same installed identity, pause and host admission boundaries. */
export async function createBackgroundNormalizationCompiler(
  input: BackgroundProviderContext,
): Promise<RepositoryDocumentNormalizationCompiler> {
  const context = await admittedBackgroundContext(input);
  const compiler = await createProcessDocumentNormalizationCompiler(
    backgroundProviderOptions(context),
  );
  const directory =
    context.admissionDirectory === undefined ? {} : { directory: context.admissionDirectory };
  const delegation = await loadConvergenceDelegation(context.storage.paths.repositoryRoot);
  if (delegation === null)
    throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
  const normalizeObserved: NonNullable<
    RepositoryDocumentNormalizationCompiler["normalizeObserved"]
  > = async (envelope, signal) => {
    const admission = await acquireKnowledgeProviderAdmission({
      repositoryRoot: context.storage.paths.repositoryRoot,
      provider: context.provider,
      liveWorkPending:
        context.liveWorkPending ??
        (async () =>
          hasCurrentForegroundLease(
            await listAssignments(context.storage.paths.repositoryRoot),
            Date.now(),
          )),
      ...directory,
    });
    if (admission === null)
      throw new KnowledgeConvergenceRuntimeError("knowledge_capacity_unavailable");
    try {
      await assertConvergenceDelegation({
        repositoryRoot: context.storage.paths.repositoryRoot,
        projectId: context.storage.manifest.projectId,
        expectedHash: delegation.contentHash,
        provider: context.provider,
      });
      await reserveConvergenceProviderCall({
        repositoryRoot: context.storage.paths.repositoryRoot,
        events: context.storage.events,
        obligationId: delegation.contentHash,
        batchId: `legacy-normalization:${delegation.contentHash}`,
        maximumCalls: delegation.delegation.resourceCeilings.maximumProviderCalls,
      });
      if (compiler.normalizeObserved === undefined)
        throw new KnowledgeConvergenceRuntimeError("knowledge_usage_unavailable");
      return await compiler.normalizeObserved(envelope, signal);
    } catch (error) {
      if (error instanceof KnowledgeProviderAvailabilityError)
        await pauseKnowledgeProviderFailure(context, error);
      throw error;
    } finally {
      await admission.release();
    }
  };
  return {
    descriptor: compiler.descriptor,
    normalizeObserved,
    normalize: async (envelope, signal) => (await normalizeObserved(envelope, signal)).response,
  };
}
