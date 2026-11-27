import {
  collectRecentExecutionEventSources,
  collectVerificationResultSources,
  collectVerificationResultSourcesTolerantly,
  RepositoryKnowledgeError,
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

/**
 * What an interactive query left out of its evidence sources (ADR-0649): `partial` names how many
 * recorded verification results could not be bound, and `omitted` a source whose history could not
 * be verified at all. Repository files and owner rules are never affected.
 */
export interface InteractiveKnowledgeEvidence {
  readonly verificationResults:
    | { readonly status: "complete" }
    | { readonly status: "partial"; readonly omittedCount: number }
    | { readonly status: "omitted" };
  readonly executionEvents: { readonly status: "complete" | "omitted" };
}

export interface InteractiveKnowledgeSources {
  readonly sources: RepositorySupplementalSource[];
  readonly evidence: InteractiveKnowledgeEvidence;
}

function unverifiableEvidence(error: unknown): boolean {
  return (
    error instanceof RepositoryKnowledgeError && error.code === "knowledge_evidence_source_invalid"
  );
}

/**
 * The supplemental sources of an interactive query, such as `lervo knowledge query`, which must
 * return the repository's rules even when recorded evidence cannot be verified: failing closed
 * there would silently drop rule loading before a write (ADR-0649). Each evidence source degrades
 * on its own and says so; storage that cannot open still fails.
 */
export async function collectInteractiveKnowledgeSources(
  repositoryRoot: string,
): Promise<InteractiveKnowledgeSources> {
  const storage = await openProjectStorage(repositoryRoot);
  try {
    let verificationResults: InteractiveKnowledgeEvidence["verificationResults"];
    let verificationSources: RepositorySupplementalSource[] = [];
    try {
      const collected = await collectVerificationResultSourcesTolerantly({
        events: storage.events,
        artifacts: storage.artifacts,
        loadSuite: (suiteId) => loadVerificationSuite(repositoryRoot, suiteId),
      });
      verificationSources = collected.sources;
      verificationResults =
        collected.omittedCount === 0
          ? { status: "complete" }
          : { status: "partial", omittedCount: collected.omittedCount };
    } catch (error) {
      if (!unverifiableEvidence(error)) throw error;
      verificationResults = { status: "omitted" };
    }
    let executionEvents: InteractiveKnowledgeEvidence["executionEvents"] = { status: "complete" };
    let recent: RepositorySupplementalSource[] = [];
    try {
      recent = collectRecentExecutionEventSources({
        events: storage.events,
        maximumEvents: LOCAL_KNOWLEDGE_EXECUTION_EVENT_LIMIT,
      });
    } catch (error) {
      if (!unverifiableEvidence(error)) throw error;
      executionEvents = { status: "omitted" };
    }
    return {
      sources: [...verificationSources, ...recent].sort((left, right) =>
        left.path.localeCompare(right.path),
      ),
      evidence: { verificationResults, executionEvents },
    };
  } finally {
    await storage.close();
  }
}
