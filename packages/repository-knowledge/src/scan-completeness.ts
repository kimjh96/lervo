import { RepositoryKnowledgeError, type RepositoryKnowledgeScan } from "./types.js";

/** Prepared-scan consumers must never infer currency from the admitted subset. */
export function requireCompleteRepositoryKnowledgeCoverage(
  scan: Pick<RepositoryKnowledgeScan, "coverage" | "skippedForBudget">,
): void {
  if (scan.coverage === "complete") return;
  throw Object.assign(
    new RepositoryKnowledgeError(
      "knowledge_source_limit_exceeded",
      "A complete repository scan is required to claim knowledge currency.",
    ),
    { skippedForBudget: scan.skippedForBudget },
  );
}
