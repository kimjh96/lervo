import {
  collectExecutionEventSources,
  collectVerificationResultSources,
  type RepositorySupplementalSource,
} from "@lervo/repository-knowledge";
import { openProjectStorage } from "@lervo/project-storage";
import { collectLocalKnowledgeSources as collectBoundedLocalKnowledgeSources } from "@lervo/repository-context";
import { loadVerificationSuite } from "@lervo/verification";

export const collectInteractiveLocalKnowledgeSources = collectBoundedLocalKnowledgeSources;

export async function collectLocalKnowledgeSources(
  repositoryRoot: string,
): Promise<RepositorySupplementalSource[]> {
  const storage = await openProjectStorage(repositoryRoot);
  try {
    const verificationSources = await collectVerificationResultSources({
      events: storage.events,
      artifacts: storage.artifacts,
      loadSuite: (suiteId) => loadVerificationSuite(repositoryRoot, suiteId),
    });
    return [
      ...verificationSources,
      ...collectExecutionEventSources({ events: storage.events }),
    ].sort((left, right) => left.path.localeCompare(right.path));
  } finally {
    await storage.close();
  }
}
