import {
  documentFreshnessCheckFailure,
  runDocumentFreshnessChecks,
} from "./document-freshness-checks.js";
import { documentFreshnessCandidateId } from "./document-freshness-candidate.js";
import type {
  DocumentFreshnessCandidateV1,
  DocumentFreshnessCheckResult,
  DocumentFreshnessHunk,
  DocumentFreshnessOwnership,
  DocumentFreshnessPolicy,
} from "./document-freshness-contract.js";
import {
  unresolvedDocumentReferences,
  type DocumentFreshnessTreeOracle,
} from "./document-freshness-references.js";
import {
  planReverseHeaderEdit,
  type ReverseHeaderDeclaration,
} from "./document-reverse-headers.js";
import { canonicalJson, sha256, stableId } from "./integrity.js";

/** The marker of a reverse header candidate (ADR-0631); absent on every other candidate. */
export interface DocumentFreshnessMechanicalEdit {
  kind: "reverse_header";
  /** The record's own ADR number; the commit subject names it instead of the long path. */
  adr: string;
  declarations: ReverseHeaderDeclaration[];
  /** Content hash of each declaring record, bound when the candidate was built. */
  declaringHashes: Record<string, string>;
}

/**
 * An insert-only edit changes no existing reference, so `references_resolve` judges only the lines
 * it inserts: a record with an older broken link elsewhere still gets its reverse lines, and the
 * broken link stays a freshness finding of its own.
 */
function insertOnlyReferences(
  checks: DocumentFreshnessCheckResult[],
  unresolvedInserted: readonly string[],
): DocumentFreshnessCheckResult[] {
  return checks.map((check) =>
    check.code !== "references_resolve"
      ? check
      : {
          code: check.code,
          status: unresolvedInserted.length === 0 ? "passed" : "failed",
          detail:
            unresolvedInserted.length === 0
              ? "inserted_references_resolve"
              : `unresolved=${unresolvedInserted.slice(0, 5).join(",")}`,
        },
  );
}

/** The finding a reverse header candidate settles: the record and the lines it lacks. */
export function reverseHeaderFindingDigest(
  documentPath: string,
  declarations: readonly ReverseHeaderDeclaration[],
): string {
  return sha256(canonicalJson({ kind: "reverse_header", documentPath, declarations }));
}

/**
 * A verified freshness edit that inserts a record's missing reverse header lines (ADR-0631). It
 * makes no provider call: each hunk's claim cites the declaring record's bytes, the freshness
 * checks run as for any edit, and it needs no cross-check. A failed check or an unplannable header
 * gives null, and the record stays as it is.
 */
export function reverseHeaderCandidate(input: {
  documentPath: string;
  /** The record's own ADR number, as the relation web records it. */
  adr: string;
  source: Uint8Array;
  declarations: readonly ReverseHeaderDeclaration[];
  declaringHashes: Readonly<Record<string, string>>;
  documentOwnership: DocumentFreshnessOwnership;
  policy: DocumentFreshnessPolicy;
  oracle: DocumentFreshnessTreeOracle;
  detectedAt: string;
  now: string;
}): DocumentFreshnessCandidateV1 | null {
  const content = Buffer.from(input.source).toString("utf8");
  const plan = planReverseHeaderEdit({
    path: input.documentPath,
    content,
    declarations: input.declarations,
  });
  if (plan.status !== "planned") return null;
  const evidence = [...new Set(input.declarations.map((declaration) => declaration.by))].map(
    (path) => ({ path, hash: input.declaringHashes[path]!, lineRange: null }),
  );
  if (evidence.some((item) => item.hash === undefined)) return null;
  const claim = {
    text: `The cited decision records declare that they amend or supersede part of ${input.documentPath}.`,
    evidence,
  };
  const range = { startByte: plan.startByte, endByte: plan.startByte };
  const hunk: DocumentFreshnessHunk = {
    hunkId: stableId("kfh", { range, replacement: plan.replacement }, 16),
    range,
    beforeHash: sha256(new Uint8Array()),
    replacement: plan.replacement,
    changeClass: "factual_reference",
    ownership: input.documentOwnership,
    managedBlockId: null,
    authorityRequired: "none",
    crossCheckRequired: false,
    claims: [{ claimDigest: sha256(canonicalJson(claim)), ...claim }],
  };
  const output = new Uint8Array(Buffer.from(plan.output, "utf8"));
  const sourceHash = sha256(input.source);
  const checks = insertOnlyReferences(
    runDocumentFreshnessChecks({
      documentPath: input.documentPath,
      source: input.source,
      sourceHash,
      currentHash: sourceHash,
      output,
      hunks: [hunk],
      finding: { references: [] },
      bundleEvidence: new Set(evidence.map((item) => `${item.path}\0${item.hash}`)),
      policy: input.policy,
      oracle: input.oracle,
    }),
    unresolvedDocumentReferences({
      path: input.documentPath,
      content: plan.replacement,
      oracle: input.oracle,
    }).map((reference) => reference.target),
  );
  if (documentFreshnessCheckFailure(checks) !== null) return null;
  const findingDigest = reverseHeaderFindingDigest(input.documentPath, input.declarations);
  const mechanical: DocumentFreshnessMechanicalEdit = {
    kind: "reverse_header",
    adr: input.adr,
    declarations: [...input.declarations],
    declaringHashes: Object.fromEntries(evidence.map((item) => [item.path, item.hash])),
  };
  const candidate: Omit<DocumentFreshnessCandidateV1, "candidateId"> = {
    schemaVersion: 1,
    generationId: stableId("kfrh", { findingDigest, sourceHash }),
    findingDigest,
    bundleHash: sha256(canonicalJson(mechanical)),
    documentPath: input.documentPath,
    sourceHash,
    priorityClass: "canonical",
    operation: "edit",
    hunks: [hunk],
    archive: null,
    explanation: null,
    reasonsAddressed: [],
    authorityRequired: "none",
    state: "verified",
    checks,
    crossCheck: "not_required",
    evidenceCount: evidence.length,
    evidenceTruncated: false,
    beforeBytesRef: null,
    afterHash: sha256(output),
    appliedHash: null,
    appliedHunkIds: [],
    pendingHunkIds: [hunk.hunkId],
    tokensObserved: 0,
    rejection: null,
    approval: null,
    commitHash: null,
    acknowledgedAt: null,
    detectedAt: input.detectedAt,
    createdAt: input.now,
    updatedAt: input.now,
    mechanical,
  };
  return { candidateId: documentFreshnessCandidateId(candidate), ...candidate };
}
