import {
  queryRepositoryKnowledge,
  type RepositorySupplementalSource,
} from "@lervo/repository-knowledge";

/** Candidate retrieval consumes only a validated semantic query and never raw request text. */
export async function selectTerminalContextCandidates(input: {
  repositoryRoot: string;
  retrievalQuery: string;
  groundingStatus: "ready" | "clarify" | "abstain" | "approval_required";
  supplementalSources: RepositorySupplementalSource[];
}) {
  const result = await queryRepositoryKnowledge({
    repositoryRoot: input.repositoryRoot,
    query: input.retrievalQuery,
    limit: 6,
    supplementalSources: input.supplementalSources,
  });
  return {
    sourceSnapshotId: result.sourceSnapshotId,
    candidates: result.hits,
    selected: input.groundingStatus === "ready" ? result.hits : [],
  };
}
