import { durableInstructionCatalogEntry } from "./durable-instruction.js";
import { canonicalJson, sha256 } from "./integrity.js";
import type { RepositoryKnowledgePolicy, RepositoryKnowledgeScan } from "./types.js";

/** The bounded canonical-instruction catalog that durable-instruction grounding and capture see. */
export interface DurableInstructionCatalogInspection {
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

const MAXIMUM_CATALOG_ENTRIES = 32;

/**
 * Projects `AGENTS.md` and `docs/instructions/**` from one scan. The catalog is complete only
 * when every instruction source fits in the bound; an incomplete catalog never yields a candidate.
 */
export function inspectDurableInstructionCatalog(input: {
  policy: RepositoryKnowledgePolicy;
  scan: RepositoryKnowledgeScan;
}): DurableInstructionCatalogInspection {
  const sources = input.scan.sources
    .filter(
      (source) =>
        source.status === "included" &&
        source.content !== undefined &&
        (source.path === "AGENTS.md" || source.path.startsWith("docs/instructions/")),
    )
    .sort((left, right) => left.path.localeCompare(right.path));
  const complete = sources.length <= MAXIMUM_CATALOG_ENTRIES;
  return {
    complete,
    sourceSnapshotId: input.scan.snapshotId,
    semanticCatalog: {
      schemaVersion: 1,
      retrievalLanguage: input.policy.publication.language,
      canonicalInstructions: {
        complete,
        entries: sources
          .slice(0, MAXIMUM_CATALOG_ENTRIES)
          .map((source) =>
            durableInstructionCatalogEntry({ path: source.path, content: source.content! }),
          ),
      },
    },
  };
}

/**
 * Digest of the instruction entries alone. Unlike the source snapshot, it does not change when
 * unrelated repository files or execution events change, so review can bind to it.
 */
export function durableInstructionCatalogDigest(
  entries: ReadonlyArray<{ path: string; contentHash: string }>,
): string {
  return sha256(
    canonicalJson({
      entries: entries
        .map((entry) => ({ path: entry.path, contentHash: entry.contentHash }))
        .sort((left, right) => left.path.localeCompare(right.path)),
    }),
  );
}
