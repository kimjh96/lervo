import { describe, expect, it } from "vitest";

import { documentFreshnessAutoApplicableHunks } from "../src/document-freshness-candidate-state.js";
import type {
  DocumentFreshnessCandidateV1,
  DocumentFreshnessHunk,
} from "../src/document-freshness-contract.js";
import {
  documentFreshnessCrossCheckRetryAt,
  projectDocumentFreshnessDebt,
} from "../src/document-freshness-debt.js";
import { buildDocumentFreshnessArchiveCrossCheckInput } from "../src/document-freshness-archive-cross-check.js";
import {
  buildDocumentFreshnessCrossCheckInput,
  documentFreshnessCandidateNeedsCrossCheck,
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
const archivePlan = {
  targetPath: "docs/archive/guide.md",
  banner: "> Historical: archived on 2026-11-02.\n\n",
  inboundLinkRewrites: [
    { path: "docs/a.md", line: 3, from: "../guide.md", to: "archive/guide.md" },
  ],
  outgoingLinkRewrites: [],
  ownership: "user_owned" as const,
  inboundSourceHashes: { "docs/a.md": `sha256:${"7".repeat(64)}` },
};
const userOwned = hunk({
  hunkId: `kfh_${"2".repeat(16)}`,
  range: { startByte: 45, endByte: 73 },
  replacement: "Routes are in `docs/routes.md`.",
  changeClass: "factual_reference",
  ownership: "user_owned",
  managedBlockId: null,
});
const userStatement = hunk({
  hunkId: `kfh_${"3".repeat(16)}`,
  ownership: "user_owned",
  managedBlockId: null,
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
    authorityRequired: "none",
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

  it("lets one agreement apply a user-owned factual hunk without the owner", () => {
    const settled = settleDocumentFreshnessCrossCheck(candidate([userOwned]), {
      ...reviewer,
      status: "verdicts",
      verdicts: [{ hunkId: userOwned.hunkId, verdict: "agree", reason: "ok" }],
    });
    expect(settled).toMatchObject({
      state: "verified",
      crossCheck: "agreement",
      authorityRequired: "none",
    });
    expect(documentFreshnessAutoApplicableHunks(settled).map((item) => item.hunkId)).toEqual([
      userOwned.hunkId,
    ]);
  });

  it("needs two independent agreements for a user-owned statement or safety hunk", () => {
    for (const required of [userStatement, hunk({ changeClass: "safety_or_policy" })]) {
      const first = settleDocumentFreshnessCrossCheck(candidate([required]), {
        ...reviewer,
        status: "verdicts",
        verdicts: [{ hunkId: required.hunkId, verdict: "agree", reason: "ok" }],
      });
      // The first agreement arms a second round in a fresh session; nothing applies yet.
      expect(first).toMatchObject({
        state: "generated",
        crossCheck: "unavailable",
        crossCheckRounds: [{ status: "settled", outcome: "agreement", runId: reviewer.runId }],
        crossCheckReview: { status: "pending", inputHash: `sha256:${"9".repeat(64)}` },
      });
      expect(documentFreshnessAutoApplicableHunks(first)).toEqual([]);
      const second = settleDocumentFreshnessCrossCheck(first, {
        ...reviewer,
        runId: "run_freshness_bbbbbbbbbbbbbbbbbbbbbbbb",
        status: "verdicts",
        verdicts: [{ hunkId: required.hunkId, verdict: "agree", reason: "ok" }],
      });
      expect(second).toMatchObject({
        state: "verified",
        crossCheck: "agreement",
        tokensObserved: 3_300,
      });
      expect(documentFreshnessAutoApplicableHunks(second)).toHaveLength(1);
      const contested = settleDocumentFreshnessCrossCheck(first, {
        ...reviewer,
        status: "verdicts",
        verdicts: [{ hunkId: required.hunkId, verdict: "disagree", reason: "unsupported" }],
      });
      expect(contested).toMatchObject({
        state: "rejected",
        rejection: { reasonCode: "cross_check_disagreement" },
      });
    }
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

  it("holds every required hunk for Lervo's retry when the cross-check is unavailable", () => {
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
      authorityRequired: "none",
      crossCheckReview: { unavailableReason: "cross_check_response_invalid", verdicts: [] },
    });
    expect(documentFreshnessAutoApplicableHunks(settled)).toEqual([]);
    const settledAt = Date.parse(reviewer.settledAt);
    expect(documentFreshnessCrossCheckRetryAt(settled)?.getTime()).toBe(settledAt + 3_600_000);
    const retried = { ...settled, crossCheckReview: { ...settled.crossCheckReview!, retries: 6 } };
    expect(documentFreshnessCrossCheckRetryAt(retried)?.getTime()).toBe(settledAt + 86_400_000);
  });

  it("rejects an over-budget cross-check instead of holding it", () => {
    const settled = settleDocumentFreshnessCrossCheck(candidate([managed]), {
      ...reviewer,
      tokensObserved: 0,
      status: "unavailable",
      reason: "freshness_budget_exhausted",
    });
    expect(settled).toMatchObject({
      state: "rejected",
      rejection: { reasonCode: "freshness_budget_exhausted", rejectorKind: "budget" },
    });
  });

  it("needs a call for archives and for edits with a required hunk and no outcome", () => {
    const verified = { ...candidate([managed]), state: "verified_pending_cross_check" as const };
    expect(documentFreshnessCandidateNeedsCrossCheck(verified)).toBe(true);
    expect(
      documentFreshnessCandidateNeedsCrossCheck({
        ...verified,
        hunks: [{ ...managed, crossCheckRequired: false }],
      }),
    ).toBe(false);
    expect(
      documentFreshnessCandidateNeedsCrossCheck({
        ...verified,
        operation: "archive",
        hunks: [],
        archive: archivePlan,
      }),
    ).toBe(true);
    expect(
      documentFreshnessCandidateNeedsCrossCheck({ ...verified, crossCheck: "agreement" }),
    ).toBe(false);
  });

  it("asks the reviewer about the archive move and its inbound link rewrites", () => {
    const input = buildDocumentFreshnessArchiveCrossCheckInput({
      candidate: { ...candidate([]), archive: archivePlan },
      source: Buffer.from(source),
      evidence: [{ path: "ops/build.md", hash: evidenceHash, text: "# Build" }],
    });
    expect(input.hunks.map((item) => item.changeClass)).toEqual([
      "archive",
      "archive_inbound_links",
    ]);
    expect(input.hunks[0]!.after).toContain("docs/archive/guide.md");
    expect(input.hunks[1]).toMatchObject({
      before: "docs/a.md:3 ../guide.md",
      after: "docs/a.md:3 archive/guide.md",
    });
    expect(input.evidence).toEqual([
      { path: "ops/build.md", hash: evidenceHash, excerpt: "# Build", truncated: false },
    ]);
    const archive = { ...candidate([]), operation: "archive" as const, archive: archivePlan };
    const first = settleDocumentFreshnessCrossCheck(archive, {
      ...reviewer,
      status: "verdicts",
      verdicts: input.hunks.map((item) => ({
        hunkId: item.hunkId,
        verdict: "agree",
        reason: "ok",
      })),
    });
    expect(first).toMatchObject({
      state: "generated",
      crossCheckRounds: [{ outcome: "agreement" }],
    });
    const second = settleDocumentFreshnessCrossCheck(first, {
      ...reviewer,
      status: "verdicts",
      verdicts: input.hunks.map((item) => ({
        hunkId: item.hunkId,
        verdict: "agree",
        reason: "ok",
      })),
    });
    expect(second).toMatchObject({ state: "verified", crossCheck: "agreement" });
  });

  it("holds a finding as Lervo debt after its regeneration fails too, with doubling backoff", () => {
    const now = new Date("2026-11-02T00:00:00.000Z");
    const rejected = (id: string, createdAt: string, reasonCode = "cross_check_disagreement") => ({
      ...candidate([managed]),
      candidateId: id,
      createdAt,
      state: "rejected" as const,
      rejection: {
        reasonCode: reasonCode as "cross_check_disagreement",
        rejectorKind: "cross_check" as const,
        contestedHunkIds: [managed.hunkId],
      },
    });
    const first = rejected(`kfresh_${"1".repeat(24)}`, "2026-11-01T00:00:00.000Z");
    const second = rejected(`kfresh_${"2".repeat(24)}`, "2026-11-01T01:00:00.000Z");
    expect(projectDocumentFreshnessDebt({ candidates: [first], previous: [], now })).toEqual([]);
    const [debt] = projectDocumentFreshnessDebt({ candidates: [first, second], previous: [], now });
    expect(debt).toEqual({
      findingDigest: first.findingDigest,
      documentPath: "docs/guide.md",
      candidateId: second.candidateId,
      reason: "cross_check_disagreement_repeated",
      since: now.toISOString(),
      attempts: 1,
      retryAt: "2026-11-03T00:00:00.000Z",
    });
    // The same candidate keeps the debt; a failed retry doubles the backoff.
    const later = new Date("2026-11-04T00:00:00.000Z");
    expect(
      projectDocumentFreshnessDebt({ candidates: [first, second], previous: [debt!], now: later }),
    ).toEqual([debt]);
    const third = rejected(`kfresh_${"3".repeat(24)}`, "2026-11-03T01:00:00.000Z");
    expect(
      projectDocumentFreshnessDebt({
        candidates: [first, second, third],
        previous: [debt!],
        now: later,
      }),
    ).toEqual([
      expect.objectContaining({
        attempts: 2,
        since: now.toISOString(),
        retryAt: "2026-11-06T00:00:00.000Z",
      }),
    ]);
    // An applied candidate clears the debt.
    const applied = { ...third, state: "applied" as const, rejection: null };
    expect(
      projectDocumentFreshnessDebt({
        candidates: [first, second, applied],
        previous: [debt!],
        now,
      }),
    ).toEqual([]);
    // An undetermined answer twice, or one exhausted budget, is debt too.
    const undetermined = (id: string, createdAt: string) => ({
      ...rejected(id, createdAt, "candidate_invalid"),
      operation: "needs_owner_input" as const,
    });
    expect(
      projectDocumentFreshnessDebt({
        candidates: [
          undetermined(`kfresh_${"4".repeat(24)}`, "2026-11-01T00:00:00.000Z"),
          undetermined(`kfresh_${"5".repeat(24)}`, "2026-11-01T01:00:00.000Z"),
        ],
        previous: [],
        now,
      }).map((entry) => entry.reason),
    ).toEqual(["freshness_evidence_undetermined"]);
    expect(
      projectDocumentFreshnessDebt({
        candidates: [
          rejected(
            `kfresh_${"6".repeat(24)}`,
            "2026-11-01T00:00:00.000Z",
            "freshness_budget_exhausted",
          ),
        ],
        previous: [],
        now,
      }).map((entry) => entry.reason),
    ).toEqual(["budget_exceeded"]);
  });
});
