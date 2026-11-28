// What `lervo migrate knowledge` prints while normalization waits for a provider, including the
// documents a size split must divide first (ADR-0653), so none is passed over silently.
import type { inspectConfiguredDocumentNormalization } from "@lervo/repository-knowledge";

/**
 * The line naming documents still too large to normalize, such as one block over the bound or a
 * document over the split maximum, so normalization never passes them silently; empty when none.
 */
export function oversizedDocumentsLine(
  documents: ReadonlyArray<{ path: string; byteCount: number }>,
): string {
  if (documents.length === 0) return "";
  const named = documents
    .slice(0, 3)
    .map((document) => `${document.path} (${document.byteCount} bytes)`);
  const rest = documents.length - named.length;
  return `too large to normalize, split first: ${named.join(", ")}${rest > 0 ? ` and ${rest} more` : ""}\n`;
}

/**
 * What `lervo migrate knowledge` prints when normalization waits for a provider: the pending
 * documents, and any still too large to normalize, which the size split names.
 */
export function normalizationProviderSelection(
  repositoryRoot: string,
  normalization: Awaited<ReturnType<typeof inspectConfiguredDocumentNormalization>>,
  json: boolean | undefined,
): string {
  if (json)
    return `${JSON.stringify(
      {
        schemaVersion: 1,
        planKind: "document_normalization_provider_selection",
        status: "provider_required",
        repositoryRoot,
        outputLanguage: normalization.outputLanguage,
        formatVersion: normalization.formatVersion,
        eligibleDocuments: normalization.eligibleDocuments,
        currentDocuments: normalization.currentDocuments,
        pendingDocuments: normalization.pendingDocuments,
        oversizedDocuments: normalization.oversizedDocuments,
        supportedProviders: ["codex", "claude"],
      },
      null,
      2,
    )}\n`;
  return `Repository content normalization requires an installed provider.\npending documents: ${normalization.pendingDocuments.length}/${normalization.eligibleDocuments}\n${oversizedDocumentsLine(normalization.oversizedDocuments)}language: ${normalization.outputLanguage} · format: ${normalization.formatVersion}\nRun lervo migrate knowledge --provider codex (or claude) to create the reviewable rewrite candidate.\n`;
}
