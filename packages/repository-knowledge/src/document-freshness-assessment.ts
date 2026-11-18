import { documentFreshnessUserOwnedChange } from "./document-freshness-candidate-state.js";
import { canonicalJson, sha256 } from "./integrity.js";
import type { DocumentFreshnessCandidateV1 } from "./document-freshness-contract.js";

export const DOCUMENT_FRESHNESS_EVIDENCE_CONTRACT = sha256(
  "lervo.document-freshness.evidence.v2.file-tree-bounded",
);
export const DOCUMENT_FRESHNESS_ASSESSMENT_CONTRACT = sha256(
  canonicalJson([
    DOCUMENT_FRESHNESS_EVIDENCE_CONTRACT,
    "lervo.document-freshness.assessment.v1.independent-no-change",
  ]),
);

export interface DocumentFreshnessDependencyWitness {
  schemaVersion: 1;
  policyHash: string;
  verificationContractHash: string;
  referenceDigest: string;
  objects: Array<{ path: string; objectName: string | null }>;
  evidence: Array<{ path: string; hash: string }>;
}

export interface DocumentFreshnessAssessmentV1 {
  schemaVersion: 1;
  documentPath: string;
  documentHash: string;
  assessedRevision: string;
  assessedAt: string;
  dependency: DocumentFreshnessDependencyWitness;
  dependencyDigest: string;
  evidenceBundleHash: string;
  reviewerIdentity: string;
  verificationContractHash: string;
  outcome: "verified_no_change";
}

export function documentFreshnessDependencyDigest(
  witness: DocumentFreshnessDependencyWitness,
): string {
  return sha256(canonicalJson(witness));
}

/**
 * Held candidates Lervo cannot finish under ADR-0561 and regenerates instead, as technical
 * recovery that never needs the owner: a record that waited for owner authority, and a held
 * candidate whose cross-check cannot be retried because it agreed already or its input is missing.
 * A partial apply stays committed; its commit remains in Git history.
 */
export function documentFreshnessCandidateNeedsRegeneration(
  candidate: DocumentFreshnessCandidateV1,
): boolean {
  if (candidate.rejection !== null) return false;
  // AGENTS.md invariant 5: user-owned hunks left after a partial apply are the suggestion.
  if (candidate.state === "partially_applied" && documentFreshnessUserOwnedChange(candidate))
    return false;
  if (candidate.state === "waiting_authority")
    return candidate.appliedHash === null && candidate.approval === null;
  if (candidate.state !== "verified_pending_cross_check" && candidate.state !== "partially_applied")
    return false;
  return (
    candidate.crossCheck !== "unavailable" ||
    candidate.crossCheckReview?.inputHash == null ||
    candidate.crossCheckReview.unavailableReason === "cross_check_input_unavailable"
  );
}

/** Exact semantic settlement never suppresses a missing reference or incomplete dependency set. */
export function documentFreshnessAssessmentMatches(input: {
  assessment: DocumentFreshnessAssessmentV1;
  documentHash: string;
  policyHash: string;
  connectedPaths: readonly string[];
  objects: ReadonlyMap<string, string | null>;
  revision: string;
  now: Date;
}): boolean {
  const a = input.assessment;
  return (
    a.schemaVersion === 1 &&
    a.outcome === "verified_no_change" &&
    a.documentHash === input.documentHash &&
    a.dependency.policyHash === input.policyHash &&
    a.verificationContractHash === DOCUMENT_FRESHNESS_ASSESSMENT_CONTRACT &&
    a.dependency.verificationContractHash === DOCUMENT_FRESHNESS_ASSESSMENT_CONTRACT &&
    a.dependencyDigest === documentFreshnessDependencyDigest(a.dependency) &&
    a.reviewerIdentity.length > 0 &&
    a.dependency.objects.length <= 256 &&
    Date.parse(a.assessedAt) <= input.now.getTime() &&
    input.now.getTime() - Date.parse(a.assessedAt) < 365 * 86_400_000 &&
    input.connectedPaths.every((path) =>
      a.dependency.objects.some((object) => object.path === path),
    ) &&
    a.dependency.objects.every(
      (object) =>
        input.objects.has(`${input.revision}:${object.path}`) &&
        input.objects.get(`${input.revision}:${object.path}`) === object.objectName,
    )
  );
}
