import type { DocumentNormalizationPreflight } from "@lervo/repository-knowledge";

export function formatDocumentNormalizationPreflight(
  preflight: DocumentNormalizationPreflight,
): string {
  const lines = [
    `Repository document normalization preflight: ${preflight.status}`,
    `workset: ${preflight.workset.worksetId} · scope: ${preflight.workset.scope}`,
    `compiler: ${preflight.compiler.compilerId} · ${preflight.compiler.compilerBuildId}`,
    `repository: ${preflight.workset.repository.pendingDocuments} pending (${preflight.workset.repository.staleDocuments} stale, ${preflight.workset.repository.unrecordedDocuments} unrecorded)`,
    `selection: ${preflight.workset.selectedDocuments} documents · ${preflight.workset.sourceBytes} bytes · ${preflight.selection.envelopeCount} envelopes`,
    `cache: ${preflight.selection.cacheHits} hits · ${preflight.selection.cacheMisses} misses`,
    `provider call capacity: ${preflight.selection.providerCallCapacity}/${preflight.ceilings.maximumProviderCalls}`,
    `source-byte ceiling: ${preflight.workset.sourceBytes}/${preflight.ceilings.maximumSourceBytes}`,
  ];
  for (const document of preflight.selection.documents)
    lines.push(
      `  ${document.path} · ${document.contentHash} · ${document.byteCount} bytes · ${document.lifecycle} · cache ${document.cache}`,
    );
  for (const blocker of preflight.blockers)
    lines.push(`  blocker [${blocker.code}] observed ${blocker.observed} · limit ${blocker.limit}`);
  lines.push("No normalization provider request or repository write was performed.");
  return `${lines.join("\n")}\n`;
}
