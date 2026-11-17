import { posix } from "node:path";

import {
  evaluateDocumentLayout,
  type DocumentLayoutCapacityFinding,
  type DocumentLayoutSnapshotEntry,
} from "@lervo/documents";
import type { DecisionTaxonomy } from "@lervo/project";

import { providerSurfaceRoles } from "./provider-surface-descriptors.js";
import type { RepositoryLayoutCandidate } from "./repository-layout-candidates.js";
import type { RepositoryKnowledgeScan } from "./types.js";

/**
 * ADR-0583: one directory over its capacity limit, as a layout plan reports it. `moves_held`
 * means the plan kept the moves that would overfill it in place; `existing_overflow` means the
 * plan leaves the directory alone.
 */
export type RepositoryLayoutCapacityFinding = Omit<
  Extract<DocumentLayoutCapacityFinding, { directory: string }>,
  "operationIds"
> & { disposition: "moves_held" | "existing_overflow" };

function parent(path: string): string {
  const directory = posix.dirname(path);
  return directory === "." ? "." : directory;
}

/** A move puts a document into the finding's directory, or a new child under it. */
function moveFills(
  finding: Extract<DocumentLayoutCapacityFinding, { directory: string }>,
  candidate: RepositoryLayoutCandidate,
): boolean {
  const from = parent(candidate.source.path);
  const to = parent(candidate.toPath);
  if (from === to) return false;
  if (finding.code === "document_directory_file_capacity_exceeded") return to === finding.directory;
  return finding.directory === "." || to.startsWith(`${finding.directory}/`);
}

function finding(
  item: Extract<DocumentLayoutCapacityFinding, { directory: string }>,
  disposition: RepositoryLayoutCapacityFinding["disposition"],
): RepositoryLayoutCapacityFinding {
  const { operationIds: _operationIds, ...rest } = item;
  return { ...rest, disposition };
}

/** One finding per directory and code; the first, a held move's, outranks later overflow. */
function uniqueFindings(
  findings: readonly RepositoryLayoutCapacityFinding[],
): RepositoryLayoutCapacityFinding[] {
  const unique = new Map<string, RepositoryLayoutCapacityFinding>();
  for (const item of findings) {
    const key = `${item.directory}\u0000${item.code}`;
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()].sort(
    (left, right) =>
      left.directory.localeCompare(right.directory) || left.code.localeCompare(right.code),
  );
}

/**
 * Keeps in place every move that would overfill a destination directory, so a layout plan never
 * proposes a layout its own permit must refuse. Held sources stay where the owner put them.
 */
export function holdRepositoryLayoutMovesOverCapacity(input: {
  scan: RepositoryKnowledgeScan;
  taxonomy: DecisionTaxonomy;
  candidates: readonly RepositoryLayoutCandidate[];
}): { heldDestinations: Set<string>; findings: RepositoryLayoutCapacityFinding[] } {
  const snapshot: DocumentLayoutSnapshotEntry[] = input.scan.sources.flatMap((source) =>
    source.status === "included" && /\.mdx?$/iu.test(source.path) && source.contentHash !== null
      ? [{ path: source.path, contentHash: source.contentHash, ownership: "user" as const }]
      : [],
  );
  const roles = [...input.taxonomy.documentPolicy.roles, ...providerSurfaceRoles()];
  const held: RepositoryLayoutCapacityFinding[] = [];
  const heldDestinations = new Set<string>();
  let admitted = [...input.candidates];
  // Each round holds at least one move or ends, so the loop is bounded by the candidate count.
  for (;;) {
    const evaluation = evaluateDocumentLayout({
      snapshot,
      operations: admitted.map((candidate) => ({
        operationId: candidate.source.path,
        action: "move",
        path: candidate.source.path,
        destinationPath: candidate.toPath,
        contentHash: candidate.source.contentHash ?? "",
      })),
      policy: input.taxonomy.documentPolicy.capacity,
      roles,
    });
    const overfilled = evaluation.blockers.filter(
      (item): item is Extract<DocumentLayoutCapacityFinding, { directory: string }> =>
        item.code === "document_directory_file_capacity_exceeded" ||
        item.code === "document_directory_child_capacity_exceeded",
    );
    const holding = admitted.filter((candidate) =>
      overfilled.some((item) => moveFills(item, candidate)),
    );
    if (holding.length === 0)
      return {
        heldDestinations,
        findings: uniqueFindings([
          ...held,
          ...evaluation.advisories.flatMap((item) =>
            "directory" in item ? [finding(item, "existing_overflow")] : [],
          ),
        ]),
      };
    held.push(
      ...overfilled
        .filter((item) => holding.some((candidate) => moveFills(item, candidate)))
        .map((item) => finding(item, "moves_held")),
    );
    for (const candidate of holding) heldDestinations.add(candidate.toPath);
    admitted = admitted.filter((candidate) => !heldDestinations.has(candidate.toPath));
  }
}
