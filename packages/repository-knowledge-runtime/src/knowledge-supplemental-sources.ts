import { openProjectStorage } from "@lervo/project-storage";
import {
  collectExecutionEventSourcePages,
  collectVerificationResultSources,
  loadRepositoryKnowledgePolicy,
  type RepositorySupplementalSource,
} from "@lervo/repository-knowledge";
import { loadVerificationSuite } from "@lervo/verification";

/** Verification results and execution event pages the repository knowledge scan reads beside files. */
export async function collectLocalKnowledgeSources(
  repositoryRoot: string,
): Promise<RepositorySupplementalSource[]> {
  const storage = await openProjectStorage(repositoryRoot);
  try {
    const policy = await loadRepositoryKnowledgePolicy(repositoryRoot);
    const verificationSources = await collectVerificationResultSources({
      events: storage.events,
      artifacts: storage.artifacts,
      loadSuite: (suiteId) => loadVerificationSuite(repositoryRoot, suiteId),
    });
    return [
      ...verificationSources,
      ...collectExecutionEventSourcePages({ events: storage.events, limits: policy.limits }).flat(),
    ].sort((left, right) => left.path.localeCompare(right.path));
  } finally {
    await storage.close();
  }
}
