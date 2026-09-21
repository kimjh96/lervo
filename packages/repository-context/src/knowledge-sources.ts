import {
  collectExecutionEventSources,
  collectVerificationResultSources,
  type RepositorySupplementalSource,
} from "@lervo/repository-knowledge";
import { openProjectStorage } from "@lervo/project-storage";
import { loadVerificationSuite } from "@lervo/verification";

import { selectRecentExecutionSources } from "./recent-execution-sources.js";

export const LOCAL_KNOWLEDGE_EXECUTION_EVENT_LIMIT = 4_096;

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
      ...selectRecentExecutionSources(
        collectExecutionEventSources({ events: storage.events }),
        LOCAL_KNOWLEDGE_EXECUTION_EVENT_LIMIT,
      ),
    ].sort((left, right) => left.path.localeCompare(right.path));
  } finally {
    await storage.close();
  }
}
