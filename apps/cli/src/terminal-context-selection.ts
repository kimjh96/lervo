import {
  queryRepositoryKnowledge,
  type RepositorySupplementalSource,
} from "@lervo/repository-knowledge";

/** Candidate retrieval consumes only a validated semantic query and never raw request text. */
export async function selectTerminalContextCandidates(input: {
  repositoryRoot: string;
  retrievalQuery: string;
  sourceSnapshotId: string;
  groundingStatus: "ready" | "clarify" | "abstain" | "approval_required";
  supplementalSources: RepositorySupplementalSource[];
}) {
  if (input.groundingStatus !== "ready") {
    return {
      sourceSnapshotId: input.sourceSnapshotId,
      candidates: [],
      selected: [],
      disposition: "grounding_not_ready" as const,
    };
  }
  if (input.retrievalQuery.trim() === "") {
    return {
      sourceSnapshotId: input.sourceSnapshotId,
      candidates: [],
      selected: [],
      disposition: "retrieval_query_missing" as const,
    };
  }
  const result = await queryRepositoryKnowledge({
    repositoryRoot: input.repositoryRoot,
    query: input.retrievalQuery,
    limit: 6,
    supplementalSources: input.supplementalSources,
  });
  return {
    sourceSnapshotId: result.sourceSnapshotId,
    candidates: result.hits,
    selected: result.hits,
    disposition: result.hits.length === 0 ? ("no_candidates" as const) : ("selected" as const),
  };
}
