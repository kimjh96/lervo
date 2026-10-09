import { sha256 } from "./integrity.js";
import { mapKnowledgeReads } from "./knowledge-read-scheduling.js";
import { readSafePublication } from "./repository-publication-files.js";
import type { StoredConcept, StoredValue } from "./store-reader.js";

/** Fresh publication observations in registry order, with the existing per-file safety checks. */
export async function readKnowledgeQueryPublications(
  root: string,
  concepts: readonly StoredValue<StoredConcept>[],
  maximumBytes: number,
): Promise<Array<{ concept: StoredConcept; content: string; contentHash: string }>> {
  const publications = await mapKnowledgeReads(concepts, async (stored) => {
    const concept = stored.value;
    if (concept === null || concept.publicationStatus === "deprecated") return null;
    try {
      const bytes = await readSafePublication(root, concept.path, maximumBytes);
      if (bytes === null) return null;
      return {
        concept,
        content: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        contentHash: sha256(bytes),
      };
    } catch {
      return null;
    }
  });
  return publications.filter((publication) => publication !== null);
}
