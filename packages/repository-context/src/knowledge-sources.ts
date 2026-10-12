import {
  RecentExecutionEventProjection,
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
    const recent = new RecentExecutionEventProjection(LOCAL_KNOWLEDGE_EXECUTION_EVENT_LIMIT);
    const verificationSources = await collectVerificationResultSources({
      events: storage.events,
      artifacts: storage.artifacts,
      loadSuite: (suiteId) => loadVerificationSuite(repositoryRoot, suiteId),
      observeEvent: (event) => recent.observe(event),
    });
    return [...verificationSources, ...recent.sources()].sort((left, right) =>
      left.path.localeCompare(right.path),
    );
  } finally {
    await storage.close();
  }
}
