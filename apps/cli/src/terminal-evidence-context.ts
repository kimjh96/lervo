import { prepareRepositoryQualityContext } from "@lervo/repository-context";
import { ContextQualityError, type PreparationLoad } from "@lervo/context";
import type { PreparedTerminalDocument } from "./terminal-prompt-context.js";
import type { selectTerminalContextCandidates } from "./terminal-context-selection.js";

/** Exact passage preparation and legacy receipt projection have distinct evidence boundaries. */
export async function prepareTerminalEvidence(input: {
  root: string;
  prompt: string;
  remainingBytes: number;
  instructionMaximumBytes: number;
  instructionCatalogDigest: string | null;
  selection: Awaited<ReturnType<typeof selectTerminalContextCandidates>>;
  projectorBuildId: string;
  projectedQueries: readonly string[];
}) {
  const sections: string[] = [];
  const documents: PreparedTerminalDocument[] = [];
  const loads: PreparationLoad[] = [];
  const prefixes = new Map(
    input.selection.selected.map((hit) => [
      hit.path,
      [
        `## ${hit.path}`,
        `Lervo recommendation: score=${hit.score}; freshness=${hit.freshness}; assurance=${hit.assurance}; contentHash=${hit.contentHash}`,
        `Lervo evidence marker: ${`<!-- lervo-ref:${hit.conceptId}:${hit.contentHash} -->`}`,
        "",
      ].join("\n"),
    ]),
  );
  const wrapperBytes = [...prefixes.values()].reduce(
    (sum, prefix) => sum + Buffer.byteLength(prefix) + 2,
    0,
  );
  const quality = await prepareRepositoryQualityContext({
    recordObservation: true,
    repositoryRoot: input.root,
    origin: "terminal",
    task: {
      intent: input.prompt,
      continuation: "",
      targetPaths: [],
      artifactKinds: [],
      requestedActions: [],
      conversationLocale: null,
      publicationLocale: null,
      retrievalLanguages: [],
    },
    instructionMaximumBytes: input.instructionMaximumBytes,
    evidenceMaximumBytes: Math.max(
      0,
      Math.min(12 * 1024, input.remainingBytes - wrapperBytes - 512),
    ),
    retrieval:
      input.selection.disposition === "query_projection_missing" ? "unavailable" : "completed",
    candidates: input.selection.selected,
    sourceSnapshotId: input.selection.sourceSnapshotId,
    retrievalBuildId: input.selection.retrievalBuildId ?? "retrieval_not_run",
    retrievalPlanId: input.selection.retrievalPlanId ?? "terminal_knowledge_interleave_v1",
    projectorBuildId: input.projectorBuildId,
    projectedQueries: input.projectedQueries,
  });
  if (
    quality.instructions !== null &&
    input.instructionCatalogDigest !== null &&
    quality.instructions?.report.catalogDigest !== input.instructionCatalogDigest
  )
    throw new ContextQualityError("context_binding_stale");
  let sectionLoading = false;
  for (const hit of input.selection.selected) {
    const passage = quality.passages.find((item) => item.path === hit.path);
    if (!passage) {
      loads.push({
        sourceId: hit.conceptId,
        contentHash: hit.contentHash,
        disposition: "unavailable",
        preparedByteCount: 0,
        reason: "source_unavailable",
      });
      continue;
    }
    sections.push(`${prefixes.get(hit.path)!}${passage.content}`);
    const full = passage.sections.length === 1 && passage.sections[0]!.locator === "full source";
    sectionLoading ||= !full;
    if (full) {
      loads.push({
        sourceId: hit.conceptId,
        contentHash: hit.contentHash,
        disposition: "full",
        preparedByteCount: Buffer.byteLength(passage.content),
        reason: null,
      });
      documents.push({
        conceptId: hit.conceptId,
        path: hit.path,
        contentHash: hit.contentHash,
        scope: "full",
        deliveredByteCount: Buffer.byteLength(passage.content),
        assurance: hit.assurance,
        freshness: hit.freshness,
      });
    }
  }
  if (quality.passages.length < input.selection.selected.length)
    sections.push(
      "Some selected evidence was omitted because complete sections could not be prepared within the current source and byte bounds. No partial clause was substituted.",
    );
  return { sections, documents, loads: sectionLoading ? null : loads, quality: quality.result };
}
