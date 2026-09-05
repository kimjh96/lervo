import {
  durableInstructionCatalogEntry,
  scanConfiguredRepositoryKnowledge,
  type RepositoryKnowledgePolicy,
  type RepositoryKnowledgeScan,
  type RepositorySupplementalSource,
} from "@lervo/repository-knowledge";

export interface InstructionCatalogInspection {
  complete: boolean;
  sourceSnapshotId: string;
  semanticCatalog: {
    schemaVersion: 1;
    retrievalLanguage: string;
    canonicalInstructions: {
      complete: boolean;
      entries: Array<{ path: string; contentHash: string; excerpt: string }>;
    };
  };
}

export async function inspectInstructionCatalog(input: {
  repositoryRoot: string;
  supplementalSources: RepositorySupplementalSource[];
  preparedKnowledge?: {
    policy: RepositoryKnowledgePolicy;
    scan: RepositoryKnowledgeScan;
  };
}): Promise<InstructionCatalogInspection> {
  const { policy, scan } =
    input.preparedKnowledge ??
    (await scanConfiguredRepositoryKnowledge(input.repositoryRoot, {
      supplementalSources: input.supplementalSources,
    }));
  const sources = scan.sources
    .filter(
      (source) =>
        source.status === "included" &&
        source.content !== undefined &&
        (source.path === "AGENTS.md" || source.path.startsWith("docs/instructions/")),
    )
    .sort((left, right) => left.path.localeCompare(right.path));
  const complete = sources.length <= 32;
  return {
    complete,
    sourceSnapshotId: scan.snapshotId,
    semanticCatalog: {
      schemaVersion: 1,
      retrievalLanguage: policy.publication.language,
      canonicalInstructions: {
        complete,
        entries: sources
          .slice(0, 32)
          .map((source) =>
            durableInstructionCatalogEntry({ path: source.path, content: source.content! }),
          ),
      },
    },
  };
}
