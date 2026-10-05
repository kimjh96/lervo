import type {
  DocumentFreshnessFindingSource,
  DocumentFreshnessFindingV1,
  DocumentFreshnessPathChange,
  DocumentFreshnessPublicationGroup,
  DocumentFreshnessReason,
  DocumentFreshnessReference,
} from "./document-freshness-contract.js";
import type { DocumentStalenessFinding } from "./document-staleness-evaluation.js";
import { canonicalJson, sha256 } from "./integrity.js";

const reasonOrder: DocumentFreshnessReason[] = [
  "connected_path_changed",
  "connected_path_deleted",
  "reference_target_missing",
  "review_interval_elapsed",
  "managed_input_changed",
  "superseded_by",
];

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Maps one ADR-0464 staleness finding plus the detection-side enrichment to the freshness input.
 * Pure: every field comes from the report, the drift lint sources, or the Git enrichment; the
 * freshness stage infers nothing itself. Evaluator reasons that say evidence is unobserved carry
 * no edit evidence and are dropped; unknown findings never reach this mapping.
 */
export function documentFreshnessFinding(input: {
  documentPath: string;
  documentHash: string;
  currentRevision: string;
  staleness: Pick<DocumentStalenessFinding, "reasons" | "verifiedRevision"> | null;
  sources: readonly DocumentFreshnessFindingSource[];
  connectedPathChanges: readonly DocumentFreshnessPathChange[];
  references: readonly DocumentFreshnessReference[];
  publicationGroup: DocumentFreshnessPublicationGroup;
  supersededBy: string | null;
  detectedAt: string;
}): DocumentFreshnessFindingV1 {
  const reasons = new Set<DocumentFreshnessReason>();
  const changes = [...input.connectedPathChanges].sort((left, right) =>
    compare(left.path, right.path),
  );
  for (const reason of input.staleness?.reasons ?? []) {
    if (reason === "connected_path_changed") {
      for (const change of changes)
        reasons.add(
          change.disposition === "deleted" || change.disposition === "renamed"
            ? "connected_path_deleted"
            : "connected_path_changed",
        );
      if (changes.length === 0) reasons.add("connected_path_changed");
    } else if (reason === "review_interval_elapsed" || reason === "managed_input_changed")
      reasons.add(reason);
  }
  const references = [...input.references].sort(
    (left, right) =>
      left.line - right.line ||
      compare(left.target, right.target) ||
      compare(left.symbol ?? "", right.symbol ?? ""),
  );
  if (references.some((reference) => !reference.resolved)) reasons.add("reference_target_missing");
  if (input.supersededBy !== null) reasons.add("superseded_by");
  const body = {
    schemaVersion: 1 as const,
    sources: [...new Set(input.sources)].sort(compare),
    documentPath: input.documentPath,
    documentHash: input.documentHash,
    verifiedRevision: input.staleness?.verifiedRevision ?? null,
    currentRevision: input.currentRevision,
    reasons: reasonOrder.filter((reason) => reasons.has(reason)),
    connectedPathChanges: changes,
    references,
    publicationGroup: input.publicationGroup,
    supersededBy: input.supersededBy,
  };
  return { ...body, findingDigest: sha256(canonicalJson(body)), detectedAt: input.detectedAt };
}

/** ADR-0461 fence input: changes whenever any finding's evidence or bytes change. */
export function documentFreshnessFindingsDigest(
  findings: readonly Pick<DocumentFreshnessFindingV1, "findingDigest">[],
): string {
  return sha256(canonicalJson(findings.map((finding) => finding.findingDigest).sort(compare)));
}

/** A finding with no actionable reason cannot be edited from evidence. */
export function documentFreshnessFindingActionable(finding: DocumentFreshnessFindingV1): boolean {
  return finding.reasons.some((reason) => reason !== "review_interval_elapsed");
}
