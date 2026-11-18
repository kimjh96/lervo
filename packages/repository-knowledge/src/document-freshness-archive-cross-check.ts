import type { DocumentFreshnessEvidenceItem } from "./document-freshness-candidate.js";
import type {
  DocumentFreshnessArchivePlan,
  DocumentFreshnessCandidateV1,
} from "./document-freshness-contract.js";
import {
  boundedDocumentFreshnessUtf8,
  DOCUMENT_FRESHNESS_CROSS_CHECK_EXCERPT_BYTES,
  DOCUMENT_FRESHNESS_CROSS_CHECK_TOTAL_EXCERPT_BYTES,
  DOCUMENT_FRESHNESS_CROSS_CHECK_QUESTION,
  type DocumentFreshnessCrossCheckInputV1,
} from "./document-freshness-cross-check.js";
import { stableId } from "./integrity.js";

const MAXIMUM_DOCUMENT_EXCERPT_BYTES = 4 * 1024;
const MAXIMUM_REWRITE_LIST_BYTES = 4 * 1024;

/**
 * ADR-0561 Tier 0 input for an archive: one item for the move with its historical banner, and one
 * for every inbound link rewrite together. The archive has no claims, so every bundle evidence item
 * goes in, bounded like edit excerpts. Pure; the runtime stores the input in CAS.
 */
export function buildDocumentFreshnessArchiveCrossCheckInput(input: {
  candidate: Pick<DocumentFreshnessCandidateV1, "candidateId" | "documentPath" | "sourceHash"> & {
    archive: DocumentFreshnessArchivePlan;
  };
  source: Uint8Array;
  evidence: readonly DocumentFreshnessEvidenceItem[];
}): DocumentFreshnessCrossCheckInputV1 {
  const { candidate } = input;
  const plan = candidate.archive;
  const document = boundedDocumentFreshnessUtf8(
    Buffer.from(input.source).toString("utf8"),
    MAXIMUM_DOCUMENT_EXCERPT_BYTES,
  );
  const rewrites = (list: typeof plan.inboundLinkRewrites, side: "from" | "to") =>
    boundedDocumentFreshnessUtf8(
      list.map((rewrite) => `${rewrite.path}:${rewrite.line} ${rewrite[side]}`).join("\n"),
      MAXIMUM_REWRITE_LIST_BYTES,
    ).text;
  let remaining = DOCUMENT_FRESHNESS_CROSS_CHECK_TOTAL_EXCERPT_BYTES;
  let excerptsTruncated = document.truncated;
  const evidence = [...input.evidence]
    .sort((left, right) =>
      left.path === right.path
        ? left.hash.localeCompare(right.hash)
        : left.path < right.path
          ? -1
          : 1,
    )
    .map((item) => {
      const excerpt = boundedDocumentFreshnessUtf8(
        item.text,
        Math.min(DOCUMENT_FRESHNESS_CROSS_CHECK_EXCERPT_BYTES, remaining),
      );
      remaining -= Buffer.byteLength(excerpt.text, "utf8");
      excerptsTruncated ||= excerpt.truncated;
      return {
        path: item.path,
        hash: item.hash,
        excerpt: excerpt.text,
        truncated: excerpt.truncated,
      };
    });
  const citations = evidence.map((item) => ({ path: item.path, hash: item.hash }));
  const move = {
    hunkId: documentFreshnessArchiveItemId(candidate.candidateId, "move"),
    changeClass: "archive",
    before: `${candidate.documentPath}\n${document.text}`,
    after: `${plan.targetPath}\n${plan.banner}`,
    contextBefore: "",
    contextAfter: "",
    claims: [{ text: "The document describes a superseded design.", evidence: citations }],
  };
  const inbound =
    plan.inboundLinkRewrites.length === 0
      ? []
      : [
          {
            hunkId: documentFreshnessArchiveItemId(candidate.candidateId, "inbound_links"),
            changeClass: "archive_inbound_links",
            before: rewrites(plan.inboundLinkRewrites, "from"),
            after: rewrites(plan.inboundLinkRewrites, "to"),
            contextBefore: "",
            contextAfter: "",
            claims: [
              { text: `Inbound links now point at ${plan.targetPath}.`, evidence: citations },
            ],
          },
        ];
  return {
    schemaVersion: 1,
    kind: "document_freshness.cross_check_input",
    question: DOCUMENT_FRESHNESS_CROSS_CHECK_QUESTION,
    document: { path: candidate.documentPath, hash: candidate.sourceHash },
    hunks: [move, ...inbound],
    evidence,
    excerptsTruncated,
  };
}

function documentFreshnessArchiveItemId(candidateId: string, item: "move" | "inbound_links") {
  return stableId("kfh", { candidateId, archive: item }, 16);
}
