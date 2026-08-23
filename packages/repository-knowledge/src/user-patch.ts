import { createManagedBlockPatchCandidate, ManagedBlockPatchError } from "@lervo/documents";

import type { KnowledgeCompilationCandidate } from "./semantic-compiler.js";

export const SEMANTIC_MANAGED_BLOCK_ID = "repository-knowledge";

export function semanticManagedBlockContent(
  concept: KnowledgeCompilationCandidate["concepts"][number],
): string {
  return [
    "",
    "## Reviewed repository knowledge",
    "",
    concept.summary,
    "",
    ...concept.claims.map((claim) => `- ${claim.statement}`),
    "",
  ].join("\n");
}

export function createSemanticManagedBlockPatch(input: {
  path: string;
  sourceContent: string;
  sourceHash: string;
  concept: KnowledgeCompilationCandidate["concepts"][number];
}): ReturnType<typeof createManagedBlockPatchCandidate> | null {
  const bytes = Buffer.from(input.sourceContent, "utf8");
  try {
    return createManagedBlockPatchCandidate({
      source: { path: input.path, contentHash: input.sourceHash, byteCount: bytes.byteLength, bytes },
      blockId: SEMANTIC_MANAGED_BLOCK_ID,
      replacementBytes: Buffer.from(semanticManagedBlockContent(input.concept), "utf8"),
    });
  } catch (error) {
    if (error instanceof ManagedBlockPatchError && ["block_not_found", "no_changes", "replacement_too_large"].includes(error.code)) return null;
    throw error;
  }
}
