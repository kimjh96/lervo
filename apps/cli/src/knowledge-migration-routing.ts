import {
  createRepositoryLayoutMigrationPlan,
  type RepositoryKnowledgeScan,
  type RepositoryKnowledgeScanOptions,
} from "@lervo/repository-knowledge";
import { openProjectStorage } from "@lervo/project-storage";
import {
  classifyForegroundDocumentRoutes,
  inspectDocumentRouteResolutionContext,
  observeDocumentDeferrals,
} from "@lervo/repository-knowledge-runtime";

/** Classification changes host-private evidence first; the resulting moves share the layout approval. */
export async function planKnowledgeMigrationRouting(input: {
  repositoryRoot: string;
  supplementalSources: RepositoryKnowledgeScanOptions["supplementalSources"];
  /** Classification writes only host-private evidence, so the re-plan may reuse this scan. */
  preparedScan: RepositoryKnowledgeScan;
  provider?: string;
  model?: string;
  executable?: string;
  timeoutMs?: string;
  classify: boolean;
}) {
  if (input.provider !== undefined && input.provider !== "codex" && input.provider !== "claude")
    throw new Error("--provider must be codex or claude.");
  const timeoutMs = input.timeoutMs === undefined ? undefined : Number(input.timeoutMs);
  if (
    timeoutMs !== undefined &&
    (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600_000)
  )
    throw new Error("--timeout-ms must be an integer between 1000 and 600000.");
  const documentRouteContext = await inspectDocumentRouteResolutionContext({
    repositoryRoot: input.repositoryRoot,
  });
  const options = {
    repositoryRoot: input.repositoryRoot,
    ...(input.supplementalSources === undefined
      ? {}
      : { supplementalSources: input.supplementalSources }),
    preparedScan: input.preparedScan,
    documentRouteContext,
  };
  let layout = await createRepositoryLayoutMigrationPlan(options);
  if (
    input.classify &&
    input.provider !== undefined &&
    layout.deferredDocuments.some(
      (document) => document.reason === "semantic_classification_pending",
    )
  ) {
    const storage = await openProjectStorage(input.repositoryRoot);
    try {
      const result = await classifyForegroundDocumentRoutes({
        storage,
        layout,
        provider: input.provider,
        ...(input.model === undefined ? {} : { model: input.model }),
        ...(input.executable === undefined ? {} : { executable: input.executable }),
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      });
      if (!result.providerAvailable) documentRouteContext.providerAvailable = false;
      layout = await createRepositoryLayoutMigrationPlan(options);
    } finally {
      await storage.close();
    }
  }
  await observeDocumentDeferrals({ repositoryRoot: input.repositoryRoot, layout });
  return layout;
}
