import {
  collectRecentExecutionEventSources,
  collectVerificationResultSources,
  type RepositorySupplementalSource,
} from "@lervo/repository-knowledge";
import { openProjectStorage } from "@lervo/project-storage";
import { loadVerificationSuite } from "@lervo/verification";

export const LOCAL_KNOWLEDGE_EXECUTION_EVENT_LIMIT = 4_096;

export async function collectLocalKnowledgeSources(
  repositoryRoot: string,
): Promise<RepositorySupplementalSource[]> {
  const storage = await openProjectStorage(repositoryRoot);
  try {
    // Verification results are a typed read; only the recent window traverses the whole chain.
    const verificationSources = await collectVerificationResultSources({
      events: storage.events,
      artifacts: storage.artifacts,
      loadSuite: (suiteId) => loadVerificationSuite(repositoryRoot, suiteId),
    });
    const recent = collectRecentExecutionEventSources({
      events: storage.events,
      maximumEvents: LOCAL_KNOWLEDGE_EXECUTION_EVENT_LIMIT,
    });
    return [...verificationSources, ...recent].sort((left, right) =>
      left.path.localeCompare(right.path),
    );
  } finally {
    await storage.close();
  }
}
