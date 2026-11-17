import { stableId } from "./integrity.js";
import type { RepositoryLayoutCandidates } from "./repository-layout-candidates.js";
import { RepositoryKnowledgeError } from "./types.js";

/** Each classified candidate must survive planning in exactly one stated outcome. */
function assertRepositoryLayoutCandidateAccounting(input: {
  candidates: string[];
  outcomes: string[];
}): void {
  const candidates = new Set(input.candidates);
  const outcomes = new Set(input.outcomes);
  if (
    candidates.size !== input.candidates.length ||
    outcomes.size !== input.outcomes.length ||
    candidates.size !== outcomes.size ||
    [...candidates].some((path) => !outcomes.has(path))
  )
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "Every repository layout candidate requires exactly one outcome.",
    );
}

/**
 * Destination conflicts keep their source outcome even though no operation can execute; moves
 * held for destination capacity (ADR-0583) stay in place the same way.
 */
export function accountRepositoryLayoutCandidates(input: {
  classified: RepositoryLayoutCandidates;
  blockedDestinations: ReadonlySet<string>;
  heldDestinations?: ReadonlySet<string>;
}) {
  const { classified, blockedDestinations } = input;
  const heldDestinations = input.heldDestinations ?? new Set<string>();
  const { candidates } = classified;
  const executableCandidates = candidates.filter(
    (item) => !blockedDestinations.has(item.toPath) && !heldDestinations.has(item.toPath),
  );
  const deferredDocuments = [
    ...classified.deferredDocuments,
    ...candidates
      .filter((item) => blockedDestinations.has(item.toPath) || heldDestinations.has(item.toPath))
      .map((item) => {
        const reason = blockedDestinations.has(item.toPath)
          ? ("destination_conflict" as const)
          : ("destination_capacity" as const);
        return {
          classificationId:
            item.semanticClassification?.classificationId ??
            stableId("kdroute", [item.source.path, item.source.contentHash, item.toPath]),
          subject:
            item.classification === "decision"
              ? ("decision" as const)
              : item.classification === "instruction"
                ? ("instruction" as const)
                : ("document" as const),
          path: item.source.path,
          contentHash: item.source.contentHash,
          workspacePackage: null,
          reason,
          resolution: reason,
          basis: item.classificationBasis ?? item.reason,
          destination: item.toPath,
        };
      }),
  ].sort((a, b) => a.path.localeCompare(b.path));
  assertRepositoryLayoutCandidateAccounting({
    candidates: [
      ...candidates.map((item) => item.source.path),
      ...classified.deferredDocuments.map((item) => item.path),
      ...classified.retainedDocuments.map((item) => item.path),
    ],
    outcomes: [
      ...executableCandidates.map((item) => item.source.path),
      ...deferredDocuments.map((item) => item.path),
      ...classified.retainedDocuments.map((item) => item.path),
    ],
  });
  return { executableCandidates, deferredDocuments };
}
