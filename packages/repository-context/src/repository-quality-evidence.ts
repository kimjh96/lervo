import { createHash } from "node:crypto";
import {
  documentIdForPath,
  isGeneratedInstructionPath,
  packInstructionSources,
  readRepositoryFile,
  selectEvidenceSections,
  type InstructionSource,
  type ContextQualitySourceBytes,
  MAX_CONTEXT_SOURCE_BYTES,
} from "@lervo/context";
import { canonicalHash } from "@lervo/search";
import type { ContextQualityEvidence, ContextQualityRequest } from "@lervo/schemas";

export interface QualityCandidate {
  path: string;
  contentHash: string;
}
export interface QualityPassage {
  path: string;
  contentHash: string;
  content: string;
  sections: ContextQualityEvidence["sections"];
}
const hash = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
export async function prepareRepositoryQualityEvidence(input: {
  root: string;
  request: ContextQualityRequest;
  instructions: readonly InstructionSource[];
  candidates: readonly QualityCandidate[];
  instructionMaximumBytes: number;
  evidenceMaximumBytes: number;
  retrieval: "completed" | "not_run" | "unavailable";
}) {
  const request = input.request;
  const ownerSources = input.instructions.filter((source) =>
    isGeneratedInstructionPath(source.path),
  );
  const instructions = packInstructionSources({
    sources: ownerSources,
    targetDigest: canonicalHash(request.task),
    maximumBytes: input.instructionMaximumBytes,
  });
  const sources: ContextQualitySourceBytes[] = [];
  const sections: ContextQualityEvidence["sections"] = [];
  const obligations: ContextQualityEvidence["obligations"] = [];
  for (const source of input.instructions) {
    if (!source.content.length) continue;
    const sourceId = documentIdForPath(source.path);
    const bytes = Buffer.from(source.content);
    sources.push({ sourceId, bytes });
    const ruleId = `rule_${sourceId}`;
    obligations.push({
      ruleId,
      sourceId,
      sourceHash: source.contentHash,
      byteStart: 0,
      byteEnd: bytes.length,
      locator: "complete instruction including conditions and exceptions",
      authorityClass: isGeneratedInstructionPath(source.path)
        ? "reviewed_scope"
        : "provider_instruction",
      scopeDigest: request.scopeDigest,
      disposition: source.applicability,
      conditionRefs: [],
      exceptionRefs: [],
      verificationDefinition: "manual_source_review_v1",
    });
    // Native instruction loading belongs to the provider. Only bodies actually packed here count.
    if (isGeneratedInstructionPath(source.path) && instructions.preparedPaths.includes(source.path))
      sections.push({
        sourceId,
        sourceHash: source.contentHash,
        byteStart: 0,
        byteEnd: bytes.length,
        sectionHash: source.contentHash,
        locator: "full source",
        role: "obligation",
        required: true,
        ruleIds: [ruleId],
      });
  }
  let remaining = input.evidenceMaximumBytes;
  const passages: QualityPassage[] = [];
  for (const candidate of input.candidates) {
    if (sources.length >= 64 || sections.length >= 64) break;
    const sourceId = documentIdForPath(candidate.path);
    if (sources.some((source) => source.sourceId === sourceId)) continue;
    const bytes = await readRepositoryFile(input.root, candidate.path, MAX_CONTEXT_SOURCE_BYTES);
    const selected = selectEvidenceSections({
      bytes,
      expectedHash: candidate.contentHash,
      query: request.projectedQueries.join(" "),
      maximumBytes: Math.max(0, remaining),
    });
    if (!selected || sections.length + selected.sections.length > 64) continue;
    const exact = selected.sections.map((section) => ({
      ...section,
      sourceId,
      sourceHash: selected.sourceHash,
      role: "evidence" as const,
      required: false,
      ruleIds: [],
    }));
    sources.push({ sourceId, bytes });
    sections.push(...exact);
    passages.push({ ...candidate, content: selected.content, sections: exact });
    remaining -= Buffer.byteLength(selected.content) + 2;
  }
  const evidence: ContextQualityEvidence = {
    applicability: "complete",
    obligations,
    sections,
    corpusCoverage: {
      sourceSnapshotId: request.sourceSnapshotId,
      scopeDigest: request.scopeDigest,
      disposition: "unobserved",
      discovered: null,
      eligible: null,
      indexed: null,
      excluded: null,
      unavailable: null,
    },
    retrieval: {
      disposition: input.retrieval,
      resultDigest: input.retrieval === "completed" ? canonicalHash(input.candidates) : null,
    },
    selectedEvidenceCount: input.candidates.length,
    tokenCount: null,
    retrievalReceiptRefs: [],
  };
  return {
    evidence,
    sources,
    passages,
    instructions,
    observedSources: sources.map((source) => ({
      sourceId: source.sourceId,
      contentHash: hash(source.bytes),
    })),
  };
}
