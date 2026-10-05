import {
  inspectDurableInstructionCatalog,
  scanConfiguredRepositoryKnowledge,
  type DurableInstructionCatalogInspection,
  type RepositoryKnowledgePolicy,
  type RepositoryKnowledgeScan,
  type RepositorySupplementalSource,
} from "@lervo/repository-knowledge";

export type InstructionCatalogInspection = DurableInstructionCatalogInspection;

export async function inspectInstructionCatalog(input: {
  repositoryRoot: string;
  supplementalSources: RepositorySupplementalSource[];
  preparedKnowledge?: {
    policy: RepositoryKnowledgePolicy;
    scan: RepositoryKnowledgeScan;
  };
}): Promise<InstructionCatalogInspection> {
  return inspectDurableInstructionCatalog(
    input.preparedKnowledge ??
      (await scanConfiguredRepositoryKnowledge(input.repositoryRoot, {
        supplementalSources: input.supplementalSources,
      })),
  );
}
