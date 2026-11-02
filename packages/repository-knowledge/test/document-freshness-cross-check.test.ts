import { describe, expect, it } from "vitest";

import { documentFreshnessAutoApplicableHunks } from "../src/document-freshness-candidate-state.js";
import type {
  DocumentFreshnessCandidateV1,
  DocumentFreshnessHunk,
} from "../src/document-freshness-contract.js";
import {
  buildDocumentFreshnessCrossCheckInput,
  documentFreshnessCandidateNeedsCrossCheck,
  documentFreshnessCrossCheckBlocked,
  parseDocumentFreshnessCrossCheckResponse,
  pendingDocumentFreshnessCrossCheck,
  settleDocumentFreshnessCrossCheck,
} from "../src/document-freshness-cross-check.js";

const evidenceHash = `sha256:${"e".repeat(64)}`;
const source = "# Guide\n\nThe build guide is in `ops/old.md`.\nRoutes are in `docs/old.md`.\n";

function hunk(overrides: Partial<DocumentFreshnessHunk>): DocumentFreshnessHunk {
  return {
    hunkId: `kfh_${"1".repeat(16)}`,
    range: { startByte: 9, endByte: 44 },
    beforeHash: `sha256:${"b".repeat(64)}`,
    replacement: "The build guide now sits in `ops/build.md`.",
    changeClass: "statement",
    ownership: "lervo_managed",
    managedBlockId: "guide",
    authorityRequired: "none",
    crossCheckRequired: true,
    claims: [
      {
        claimDigest: `sha256:${"c".repeat(64)}`,
        text: "The guide moved.",
        evidence: [{ path: "ops/build.md", hash: evidenceHash, lineRange: null }],
      },
    ],
    ...overrides,
  };
}

const managed = hunk({});
const userOwned = hunk({
  hunkId: `kfh_${"2".repeat(16)}`,
  range: { startByte: 45, endByte: 73 },
  replacement: "Routes are in `docs/routes.md`.",
  changeClass: "factual_reference",
  ownership: "user_owned",
  managedBlockId: null,
  authorityRequired: "owner",
});

function candidate(hunks: DocumentFreshnessHunk[]): DocumentFreshnessCandidateV1 {
  return {
    schemaVersion: 1,
    candidateId: `kfresh_${"a".repeat(24)}`,
    generationId: `kfg_${"a".repeat(24)}`,
    findingDigest: `sha256:${"f".repeat(64)}`,
    bundleHash: `sha256:${"d".repeat(64)}`,
    documentPath: "docs/guide.md",
    sourceHash: `sha256:${"0".repeat(64)}`,
    priorityClass: "canonical",
    operation: "edit",
    hunks,
    archive: null,
    explanation: null,
    reasonsAddressed: ["connected_path_changed"],
    authorityRequired: "owner",
    state: "generated",
    checks: [],
    crossCheck: "unavailable",
    crossCheckReview: pendingDocumentFreshnessCrossCheck(`sha256:${"9".repeat(64)}`),
    evidenceCount: 1,
    evidenceTruncated: false,
    beforeBytesRef: null,
    afterHash: `sha256:${"8".repeat(64)}`,
    appliedHash: null,
    appliedHunkIds: [],
    pendingHunkIds: hunks.map((item) => item.hunkId),
    tokensObserved: 1_500,
    rejection: null,
    approval: null,
    commitHash: null,
    acknowledgedAt: null,
    detectedAt: "2026-11-01T00:00:00.000Z",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
  };
}

const settledAt = "2026-11-02T00:00:00.000Z";
const reviewer = {
  runId: `run_freshness_${"7".repeat(24)}`,
  reviewerProvider: "claude" as const,
  tokensObserved: 900,
  settledAt,
};

describe("document freshness Tier 0 cross-check (ADR-0557)", () => {
  it("builds bounded input from cited evidence only, with the exact before bytes", () => {
    const input = buildDocumentFreshnessCrossCheckInput({
      candidate: candidate([managed]),
      source: new Uint8Array(Buffer.from(source)),
      evidence: [
        { path: "ops/build.md", hash: evidenceHash, text: "x".repeat(10_000) },
        { path: "unrelated.md", hash: `sha256:${"1".repeat(64)}`, text: "never cited" },
      ],
    });
    expect(input.hunks[0]).toMatchObject({
      hunkId: managed.hunkId,
      before: "The build guide is in `ops/old.md`.",
      after: managed.replacement,
      contextBefore: "# Guide\n\n",
    });
    expect(input.evidence.map((item) => item.path)).toEqual(["ops/build.md"]);
    expect(Buffer.byteLength(input.evidence[0]!.excerpt)).toBe(6 * 1024);
    expect(input.excerptsTruncated).toBe(true);
    expect(JSON.stringify(input)).not.toContain("never cited");
  });

  it("accepts exactly one bounded verdict per hunk and rejects every other shape", () => {
    const ids = [managed.hunkId, userOwned.hunkId];
    const verdict = (hunkId: string, value = "agree") => ({ hunkId, verdict: value, reason: "ok" });
    expect(
      parseDocumentFreshnessCrossCheckResponse({ hunks: ids.map((id) => verdict(id)) }, ids),
    ).toHaveLength(2);
    for (const invalid of [
      null,
      "agree",
      { hunks: [verdict(managed.hunkId)] },
      { hunks: [verdict(managed.hunkId), verdict(managed.hunkId)] },
      { hunks: [verdict(managed.hunkId), verdict(`kfh_${"3".repeat(16)}`)] },
      { hunks: [verdict(managed.hunkId), verdict(userOwned.hunkId, "maybe")] },
      { hunks: ids.map((id) => ({ ...verdict(id), reason: "" })) },
      { hunks: ids.map((id) => ({ ...verdict(id), reason: "r".repeat(401) })) },
      { hunks: ids.map((id) => ({ ...verdict(id), extra: true })) },
      { hunks: ids.map((id) => verdict(id)), agree: true },
    ])
      expect(parseDocumentFreshnessCrossCheckResponse(invalid, ids)).toBeNull();
  });

  it("lets agreement apply a Lervo-managed statement hunk without the owner", () => {
    const settled = settleDocumentFreshnessCrossCheck(candidate([managed]), {
      ...reviewer,
      status: "verdicts",
      verdicts: [{ hunkId: managed.hunkId, verdict: "agree", reason: "ok" }],
    });
    expect(settled).toMatchObject({
      state: "verified",
      crossCheck: "agreement",
      authorityRequired: "none",
      tokensObserved: 2_400,
      crossCheckReview: { status: "settled", outcome: "agreement", runId: reviewer.runId },
    });
    expect(documentFreshnessAutoApplicableHunks(settled).map((item) => item.hunkId)).toEqual([
      managed.hunkId,
    ]);
  });

  it("keeps owner authority on user-owned hunks after agreement", () => {
    const settled = settleDocumentFreshnessCrossCheck(candidate([userOwned]), {
      ...reviewer,
      status: "verdicts",
      verdicts: [{ hunkId: userOwned.hunkId, verdict: "agree", reason: "ok" }],
    });
    expect(settled).toMatchObject({
      state: "waiting_authority",
      crossCheck: "agreement",
      authorityRequired: "owner",
    });
    expect(documentFreshnessAutoApplicableHunks(settled)).toEqual([]);
  });

  it("rejects the whole candidate on any disagreement with the contested hunk IDs", () => {
    const settled = settleDocumentFreshnessCrossCheck(candidate([managed, userOwned]), {
      ...reviewer,
      status: "verdicts",
      verdicts: [
        { hunkId: managed.hunkId, verdict: "agree", reason: "ok" },
        { hunkId: userOwned.hunkId, verdict: "disagree", reason: "unsupported" },
      ],
    });
    expect(settled).toMatchObject({
      state: "rejected",
      crossCheck: "material_disagreement",
      rejection: {
        reasonCode: "cross_check_disagreement",
        rejectorKind: "cross_check",
        contestedHunkIds: [userOwned.hunkId],
      },
    });
  });

  it("holds every required hunk for the owner when the cross-check is unavailable", () => {
    const settled = settleDocumentFreshnessCrossCheck(candidate([managed]), {
      ...reviewer,
      runId: null,
      tokensObserved: 0,
      status: "unavailable",
      reason: "cross_check_response_invalid",
    });
    expect(settled).toMatchObject({
      state: "verified_pending_cross_check",
      crossCheck: "unavailable",
      authorityRequired: "owner",
      crossCheckReview: { unavailableReason: "cross_check_response_invalid", verdicts: [] },
    });
    expect(documentFreshnessAutoApplicableHunks(settled)).toEqual([]);
  });

  it("needs a call only for edits with a required hunk and no outcome", () => {
    const verified = { ...candidate([managed]), state: "verified_pending_cross_check" as const };
    expect(documentFreshnessCandidateNeedsCrossCheck(verified)).toBe(true);
    expect(
      documentFreshnessCandidateNeedsCrossCheck({
        ...verified,
        hunks: [{ ...managed, crossCheckRequired: false }],
      }),
    ).toBe(false);
    expect(
      documentFreshnessCandidateNeedsCrossCheck({ ...verified, operation: "archive", hunks: [] }),
    ).toBe(false);
    expect(
      documentFreshnessCandidateNeedsCrossCheck({ ...verified, crossCheck: "agreement" }),
    ).toBe(false);
  });

  it("blocks a finding after its candidate and single regeneration both disagree", () => {
    const rejected = (id: string, createdAt: string) => ({
      ...candidate([managed]),
      candidateId: id,
      createdAt,
      rejection: {
        reasonCode: "cross_check_disagreement" as const,
        rejectorKind: "cross_check" as const,
        contestedHunkIds: [managed.hunkId],
      },
    });
    const first = rejected(`kfresh_${"1".repeat(24)}`, "2026-11-01T00:00:00.000Z");
    const second = rejected(`kfresh_${"2".repeat(24)}`, "2026-11-01T01:00:00.000Z");
    expect(documentFreshnessCrossCheckBlocked([first])).toEqual([]);
    expect(documentFreshnessCrossCheckBlocked([first, second])).toEqual([
      {
        findingDigest: first.findingDigest,
        documentPath: "docs/guide.md",
        candidateId: second.candidateId,
        attempts: 2,
      },
    ]);
    const later = {
      ...candidate([managed]),
      candidateId: `kfresh_${"3".repeat(24)}`,
      findingDigest: `sha256:${"4".repeat(64)}`,
      createdAt: "2026-11-02T00:00:00.000Z",
    };
    expect(documentFreshnessCrossCheckBlocked([first, second, later])).toEqual([]);
  });
});
