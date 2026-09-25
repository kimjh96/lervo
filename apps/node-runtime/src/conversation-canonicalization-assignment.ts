import { listCanonicalizationCandidates } from "@lervo/repository-knowledge";

export interface CanonicalizationAssignment {
  candidateId: string;
  contentHash: string;
  state: "candidate" | "stale";
  sourcePaths: readonly string[];
  recommendedRoots: readonly string[];
}

export function canonicalizationAssignment(
  candidates: readonly CanonicalizationAssignment[],
  reviewerId: string,
): string | null {
  if (candidates.length === 0) return null;
  return [
    "Background knowledge review left these canonicalization candidates. Unless the current request is read-only research, resolve each one in this turn after the requested work:",
    ...candidates
      .slice(0, 8)
      .map((candidate) =>
        candidate.state === "stale"
          ? `- ${candidate.candidateId} (stale): run \`lervo knowledge canonicalization review ${candidate.candidateId} --decision reject --reviewer ${reviewerId} --approval ${candidate.contentHash}\`.`
          : `- ${candidate.candidateId}: sources ${candidate.sourcePaths.slice(0, 8).join(", ")}; canonical roots ${candidate.recommendedRoots.join(", ")}. Update the one canonical document under those roots that should describe the change, then run \`lervo knowledge canonicalization promote ${candidate.candidateId} --reviewer ${reviewerId} --approval ${candidate.contentHash} --target <path> --target-hash sha256:<hex of the final bytes>\`. If the change needs no durable documentation, reject it with \`lervo knowledge canonicalization review ${candidate.candidateId} --decision reject --reviewer ${reviewerId} --approval ${candidate.contentHash}\`.`,
      ),
  ].join("\n");
}

/** Candidates a write-capable turn must resolve; an unreadable registry assigns none. */
export async function pendingCanonicalizationCandidates(
  repositoryRoot: string,
): Promise<CanonicalizationAssignment[]> {
  try {
    return (await listCanonicalizationCandidates(repositoryRoot)).flatMap((candidate) =>
      candidate.observedState === "candidate" || candidate.observedState === "stale"
        ? [
            {
              candidateId: candidate.candidateId,
              contentHash: candidate.contentHash,
              state: candidate.observedState,
              sourcePaths: candidate.sourceBindings.map((binding) => binding.path),
              recommendedRoots: candidate.recommendedRoots,
            },
          ]
        : [],
    );
  } catch {
    return [];
  }
}
