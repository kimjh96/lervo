import {
  applyDocumentFreshnessArchive,
  planDocumentFreshnessArchive,
} from "./document-freshness-archive.js";
import {
  documentFreshnessCheckFailure,
  runDocumentFreshnessChecks,
} from "./document-freshness-checks.js";
import {
  classifyDocumentFreshnessHunk,
  documentFreshnessAuthority,
  documentFreshnessCrossCheckRequired,
  documentFreshnessRangeOwnership,
} from "./document-freshness-classification.js";
import {
  documentFreshnessCandidateAuthority,
  documentFreshnessVerifiedState,
} from "./document-freshness-candidate-state.js";
import type {
  DocumentFreshnessCandidateV1,
  DocumentFreshnessCheckResult,
  DocumentFreshnessFindingV1,
  DocumentFreshnessHunk,
  DocumentFreshnessOwnership,
  DocumentFreshnessPolicy,
  DocumentFreshnessPriorityClass,
  DocumentFreshnessRejection,
} from "./document-freshness-contract.js";
import {
  applyDocumentFreshnessHunks,
  locateDocumentFreshnessHunks,
} from "./document-freshness-hunks.js";
import type { DocumentFreshnessTreeOracle } from "./document-freshness-references.js";
import type { DocumentFreshnessProposal } from "./document-freshness-response.js";
import { canonicalJson, sha256, stableId } from "./integrity.js";

/** One bundle evidence item: its coordinate and the text factual tokens are matched against. */
export interface DocumentFreshnessEvidenceItem {
  path: string;
  hash: string;
  text: string;
}

export interface DocumentFreshnessCandidateInput {
  finding: DocumentFreshnessFindingV1;
  priorityClass: DocumentFreshnessPriorityClass;
  generationId: string;
  bundleHash: string;
  source: Uint8Array;
  currentHash: string;
  documentOwnership: DocumentFreshnessOwnership;
  /** Null when the provider response failed the response contract. */
  proposal: DocumentFreshnessProposal | null;
  evidence: readonly DocumentFreshnessEvidenceItem[];
  evidenceTruncated: boolean;
  tokensObserved: number;
  policy: DocumentFreshnessPolicy;
  oracle: DocumentFreshnessTreeOracle;
  /** Decision kinds of the installed principal mandate; empty in version 1. */
  mandateKinds: readonly string[];
  /** Other current Markdown documents, read only when the proposal is an archive. */
  inboundDocuments: () => Array<{ path: string; content: string }>;
  now: string;
}

function baseCandidate(
  input: DocumentFreshnessCandidateInput,
): Omit<DocumentFreshnessCandidateV1, "candidateId"> {
  return {
    schemaVersion: 1,
    generationId: input.generationId,
    findingDigest: input.finding.findingDigest,
    bundleHash: input.bundleHash,
    documentPath: input.finding.documentPath,
    sourceHash: sha256(input.source),
    priorityClass: input.priorityClass,
    operation: input.proposal?.operation ?? "edit",
    hunks: [],
    archive: null,
    explanation: null,
    reasonsAddressed: [...input.finding.reasons],
    authorityRequired: "none",
    state: "generated",
    checks: [],
    crossCheck: "not_required",
    evidenceCount: input.evidence.length,
    evidenceTruncated: input.evidenceTruncated,
    beforeBytesRef: null,
    afterHash: null,
    appliedHash: null,
    appliedHunkIds: [],
    pendingHunkIds: [],
    tokensObserved: input.tokensObserved,
    rejection: null,
    approval: null,
    commitHash: null,
    acknowledgedAt: null,
    detectedAt: input.finding.detectedAt,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/** Identifier over the generation attempt and decision content, never time or token count. */
export function documentFreshnessCandidateId(
  candidate: Omit<DocumentFreshnessCandidateV1, "candidateId">,
): string {
  return stableId("kfresh", {
    generationId: candidate.generationId,
    findingDigest: candidate.findingDigest,
    documentPath: candidate.documentPath,
    sourceHash: candidate.sourceHash,
    operation: candidate.operation,
    hunks: candidate.hunks.map((hunk) => [hunk.range, hunk.replacement]),
    archive: candidate.archive?.targetPath ?? null,
    explanation: candidate.explanation,
    rejection: candidate.rejection?.reasonCode ?? null,
  });
}

function finish(
  candidate: Omit<DocumentFreshnessCandidateV1, "candidateId">,
): DocumentFreshnessCandidateV1 {
  return { candidateId: documentFreshnessCandidateId(candidate), ...candidate };
}

function rejected(
  candidate: Omit<DocumentFreshnessCandidateV1, "candidateId">,
  rejection: DocumentFreshnessRejection,
  checks: DocumentFreshnessCheckResult[] = candidate.checks,
): DocumentFreshnessCandidateV1 {
  return finish({ ...candidate, state: "rejected", rejection, checks });
}

function editCandidate(
  input: DocumentFreshnessCandidateInput,
  proposal: DocumentFreshnessProposal,
  base: Omit<DocumentFreshnessCandidateV1, "candidateId">,
): DocumentFreshnessCandidateV1 {
  const location = locateDocumentFreshnessHunks(
    input.source,
    proposal.hunks.map((hunk) => hunk.before),
  );
  if (location.status === "invalid")
    return rejected(base, {
      reasonCode: "candidate_invalid",
      rejectorKind: "deterministic",
      contestedHunkIds: [],
    });
  const sourceText = Buffer.from(input.source).toString("utf8");
  const evidence = new Map(input.evidence.map((item) => [`${item.path}\0${item.hash}`, item]));
  const hunks: DocumentFreshnessHunk[] = [];
  for (const [index, proposed] of proposal.hunks.entries()) {
    const range = location.ranges[index]!;
    const claims = proposed.claims.map((claim) => {
      const citations = claim.evidence.map((item) => ({ ...item, lineRange: null }));
      return { claimDigest: sha256(canonicalJson(claim)), text: claim.text, evidence: citations };
    });
    const citedEvidenceText = claims
      .flatMap((claim) => claim.evidence)
      .map((item) => {
        const bundled = evidence.get(`${item.path}\0${item.hash}`);
        return bundled === undefined ? "" : `${bundled.path}\n${bundled.text}`;
      })
      .join("\n");
    const ownership = documentFreshnessRangeOwnership({
      bytes: input.source,
      documentOwnership: input.documentOwnership,
      range: { startByte: range.startByte, endByte: range.endByte },
    });
    const changeClass = classifyDocumentFreshnessHunk({
      documentPath: input.finding.documentPath,
      source: sourceText,
      range,
      replacement: proposed.after,
      citedEvidenceText,
      safetyPatterns: input.policy.safetyPatterns,
    });
    const effectiveOwnership = ownership?.ownership ?? input.documentOwnership;
    hunks.push({
      hunkId: stableId("kfh", { range, replacement: proposed.after }, 16),
      range: { startByte: range.startByte, endByte: range.endByte },
      beforeHash: sha256(input.source.subarray(range.startByte, range.endByte)),
      replacement: proposed.after,
      changeClass,
      ownership: effectiveOwnership,
      managedBlockId: ownership?.managedBlockId ?? null,
      authorityRequired: documentFreshnessAuthority({
        ownership: effectiveOwnership,
        changeClass,
        mandateKinds: input.mandateKinds,
      }),
      crossCheckRequired: documentFreshnessCrossCheckRequired({
        ownership: effectiveOwnership,
        changeClass,
        operation: "edit",
        policy: input.policy,
      }),
      claims,
    });
  }
  hunks.sort((left, right) => left.range.startByte - right.range.startByte);
  const output = applyDocumentFreshnessHunks(input.source, hunks);
  const checks = runDocumentFreshnessChecks({
    documentPath: input.finding.documentPath,
    source: input.source,
    sourceHash: base.sourceHash,
    currentHash: input.currentHash,
    output,
    hunks,
    finding: input.finding,
    bundleEvidence: new Set(evidence.keys()),
    policy: input.policy,
    oracle: input.oracle,
  });
  const crossCheck = hunks.some((hunk) => hunk.crossCheckRequired)
    ? ("unavailable" as const)
    : ("not_required" as const);
  const candidate = {
    ...base,
    hunks,
    checks,
    authorityRequired: documentFreshnessCandidateAuthority(hunks, crossCheck),
    crossCheck,
  };
  const failure = documentFreshnessCheckFailure(checks);
  if (failure !== null)
    return rejected(candidate, {
      reasonCode: failure,
      rejectorKind: "deterministic",
      contestedHunkIds: [],
    });
  return finish({
    ...candidate,
    afterHash: sha256(output),
    state: documentFreshnessVerifiedState(hunks, crossCheck),
    pendingHunkIds: hunks.map((hunk) => hunk.hunkId),
  });
}

function archiveCandidate(
  input: DocumentFreshnessCandidateInput,
  proposal: DocumentFreshnessProposal,
  base: Omit<DocumentFreshnessCandidateV1, "candidateId">,
): DocumentFreshnessCandidateV1 {
  const content = Buffer.from(input.source).toString("utf8");
  const currentDocumentPath =
    proposal.currentDocumentPath !== null && input.oracle.exists(proposal.currentDocumentPath)
      ? proposal.currentDocumentPath
      : input.finding.supersededBy;
  const inboundDocuments = input.inboundDocuments();
  const plan = planDocumentFreshnessArchive({
    documentPath: input.finding.documentPath,
    content,
    historicalRoot: input.policy.historicalRoot,
    suggestedName: proposal.archiveName,
    currentDocumentPath,
    archivedOn: input.now.slice(0, 10),
    ownership: input.documentOwnership,
    inboundDocuments,
  });
  const applied = applyDocumentFreshnessArchive({
    plan,
    documentPath: input.finding.documentPath,
    content,
    inboundDocuments,
  });
  const bannerBytes = Buffer.byteLength(plan.banner, "utf8");
  const checks: DocumentFreshnessCheckResult[] = [
    {
      code: "source_hash",
      status: input.currentHash === base.sourceHash ? "passed" : "failed",
      detail: input.currentHash === base.sourceHash ? "source_current" : "source_changed",
    },
    {
      code: "outside_bytes_unchanged",
      status: input.oracle.exists(plan.targetPath) ? "failed" : "passed",
      detail: input.oracle.exists(plan.targetPath)
        ? "archive_target_exists"
        : "archive_target_free",
    },
    {
      code: "edit_bound",
      status: bannerBytes <= input.policy.maximumEditBytes ? "passed" : "failed",
      detail: `banner=${bannerBytes};inbound=${plan.inboundLinkRewrites.length};outgoing=${plan.outgoingLinkRewrites.length}`,
    },
  ];
  const authority = input.documentOwnership === "lervo_managed" ? "none" : "owner";
  const candidate = {
    ...base,
    archive: plan,
    checks,
    crossCheck: "unavailable" as const,
    authorityRequired: "owner" as const,
  };
  const failure = documentFreshnessCheckFailure(checks);
  if (failure !== null)
    return rejected(candidate, {
      reasonCode: failure,
      rejectorKind: "deterministic",
      contestedHunkIds: [],
    });
  return finish({
    ...candidate,
    // Archives always need the cross-check; Tier 0 covers edit hunks only, so the owner reviews.
    authorityRequired: documentFreshnessCrossCheckRequired({
      ownership: input.documentOwnership,
      changeClass: null,
      operation: "archive",
      policy: input.policy,
    })
      ? "owner"
      : authority,
    afterHash: sha256(applied.targetContent),
    state: "verified_pending_cross_check",
  });
}

/**
 * Turns one provider proposal into a candidate: locate hunks by exact text, classify, derive
 * authority, apply in memory, and run every deterministic check. Pure apart from the read-only
 * tree oracle; nothing is written. A consequential hunk leaves with `crossCheck: unavailable`;
 * the runtime then runs the ADR-0557 Tier 0 cross-check and settles it with
 * `settleDocumentFreshnessCrossCheck`.
 */
export function buildDocumentFreshnessCandidate(
  input: DocumentFreshnessCandidateInput,
): DocumentFreshnessCandidateV1 {
  const base = baseCandidate(input);
  if (input.tokensObserved > input.policy.maximumTokensPerCandidate)
    return rejected(base, {
      reasonCode: "freshness_budget_exhausted",
      rejectorKind: "budget",
      contestedHunkIds: [],
    });
  const proposal = input.proposal;
  if (proposal === null)
    return rejected(base, {
      reasonCode: "candidate_invalid",
      rejectorKind: "deterministic",
      contestedHunkIds: [],
    });
  if (proposal.operation === "no_change_needed")
    return finish({ ...base, explanation: proposal.explanation, state: "verified" });
  if (proposal.operation === "needs_owner_input")
    return finish({
      ...base,
      explanation: proposal.explanation,
      authorityRequired: "owner",
      state: "waiting_authority",
    });
  if (proposal.operation === "archive") return archiveCandidate(input, proposal, base);
  return editCandidate(input, proposal, base);
}

/** The deterministic outcome for a finding whose only reason is an elapsed review interval. */
export function reviewIntervalOnlyFreshnessCandidate(
  input: Omit<DocumentFreshnessCandidateInput, "proposal" | "tokensObserved" | "evidence">,
): DocumentFreshnessCandidateV1 {
  return finish({
    ...baseCandidate({ ...input, proposal: null, tokensObserved: 0, evidence: [] }),
    operation: "no_change_needed",
    explanation: "Only the review interval elapsed; no connected evidence changed.",
    state: "verified",
  });
}
