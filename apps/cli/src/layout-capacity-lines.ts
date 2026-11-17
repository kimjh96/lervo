import type { RepositoryLayoutCapacityFinding } from "@lervo/repository-knowledge";

/** Upgrade and migration reports show at most this many capacity findings. */
export const MAXIMUM_LAYOUT_CAPACITY_ITEMS = 16;

/** ADR-0583: one line per directory over capacity, naming its counts, limit, and disposition. */
export function layoutCapacityLines(
  findings: readonly RepositoryLayoutCapacityFinding[],
  indent: string,
): string[] {
  if (findings.length === 0) return [];
  return [
    `${indent}Directories over document capacity: ${findings.length}`,
    ...findings.slice(0, MAXIMUM_LAYOUT_CAPACITY_ITEMS).map((finding) => {
      const unit =
        finding.code === "document_directory_file_capacity_exceeded"
          ? "documents"
          : "document-bearing child directories";
      const outcome =
        finding.disposition === "moves_held"
          ? "moves into it are held; sources stay in place"
          : "existing overflow, not blocking; Lervo adds nothing there";
      return `${indent}  ${finding.directory}: ${unit} observed ${finding.observed}, projected ${finding.projected}, limit ${finding.limit} (${outcome})`;
    }),
  ];
}
