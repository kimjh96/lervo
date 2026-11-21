import { assertProviderOutputSchemaForSource, providerOutputSchema } from "@lervo/schemas";
import { describe, expect, it } from "vitest";

import {
  documentFreshnessAutoApplicableHunks,
  documentFreshnessUserOwnedChange,
} from "../src/document-freshness-candidate-state.js";
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
  documentFreshnessCrossCheckContract,
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

  it("lets an anchor hold a commit SHA the source holds, as an anchor and nowhere else (ADR-0608)", () => {
    const sha = "9c41e2f07a33b5d1e8c0a7f2b6d4e9a1c3f5b7d0";
    const pinned = "# Guide\n\nPin the tool at ${sha} before you build.\n".replace("${sha}", sha);
    const contract = documentFreshnessCrossCheckContract(
      buildDocumentFreshnessCrossCheckInput({
        candidate: candidate([
          hunk({
            range: { startByte: 9, endByte: pinned.length - 1 },
            replacement: "Pin the tool at its current release before you build.",
          }),
        ]),
        source: new Uint8Array(Buffer.from(pinned)),
        evidence: [],
      }),
    );
    const anchors = (contract.view as { hunks: { anchor: string }[] }).hunks.map(
      (item) => item.anchor,
    );
    expect(anchors.join("")).toContain(sha.slice(0, 8));
    // The anchor repeats the source by design, and its kind says so.
    expect(() => assertProviderOutputSchemaForSource(contract.schema, contract.view)).not.toThrow();
    // The same text offered as any other value is still refused.
    expect(() =>
      assertProviderOutputSchemaForSource(
        providerOutputSchema({ type: "object", properties: { pick: { enum: anchors } } }),
        contract.view,
      ),
    ).toThrow(/offers an identifier or hash from the source data/u);
  });

  it("gives the reviewer hunk references, not hunk ids or hashes, to cite (ADR-0604)", () => {
    const contract = documentFreshnessCrossCheckContract(
      buildDocumentFreshnessCrossCheckInput({
        candidate: candidate([managed, userOwned]),
        source: new Uint8Array(Buffer.from(source)),
        evidence: [{ path: "ops/build.md", hash: evidenceHash, text: "build" }],
      }),
    );
    const view = contract.view as {
      hunks: { hunk: string; claims: { evidence: { evidence: string | null }[] }[] }[];
      evidence: { evidence: string; path: string }[];
    };
    // Only the document's own hash stays: the reviewer cites nothing by hash or id.
    expect(JSON.stringify(view)).not.toMatch(/kfh_|sha256:e/u);
    expect(view.hunks.map((item) => item.hunk)).toEqual(["h1", "h2"]);
    expect(view.hunks[0]!.claims[0]!.evidence).toEqual([{ evidence: "e1", path: "ops/build.md" }]);
    expect(view.evidence).toMatchObject([{ evidence: "e1", path: "ops/build.md" }]);
    const native = contract.schema as unknown as {
      properties: { hunks: { items: { properties: { hunk: unknown } } } };
    };
    expect(native.properties.hunks.items.properties.hunk).toEqual({ enum: ["h1", "h2"] });
    // Each hunk is paired with its anchor, the start of its before and after text.
    expect(view.hunks.map((item) => (item as unknown as { anchor: string }).anchor)).toEqual([
      "The build guide is in `ops/old.md`. -> The build guide now sits in `ops/build.m...",
      expect.stringContaining(" -> "),
    ]);
    expect(
      (native.properties.hunks.items.properties as unknown as { anchor: { enum: string[] } }).anchor
        .enum,
    ).toHaveLength(2);
  });

  it("maps exactly one bounded verdict per hunk reference and rejects every other shape", () => {
    const contract = documentFreshnessCrossCheckContract(
      buildDocumentFreshnessCrossCheckInput({
        candidate: candidate([managed, userOwned]),
        source: new Uint8Array(Buffer.from(source)),
        evidence: [],
      }),
    );
    const references = ["h1", "h2"];
    const anchors = (contract.view as { hunks: { anchor: string }[] }).hunks.map(
      (item) => item.anchor,
    );
    const anchor = (hunk: string) => anchors[Number(hunk.slice(1)) - 1] ?? anchors[0]!;
    const verdict = (hunk: string, value = "agree") => ({
      hunk,
      anchor: anchor(hunk),
      verdict: value,
      reason: "ok",
    });
    expect(contract.parse({ hunks: references.map((id) => verdict(id, "disagree")) })).toEqual([
      { hunkId: managed.hunkId, verdict: "disagree", reason: "ok" },
      { hunkId: userOwned.hunkId, verdict: "disagree", reason: "ok" },
    ]);
    for (const invalid of [
      null,
      "agree",
      { hunks: [verdict("h1")] },
      { hunks: [verdict("h1"), verdict("h1")] },
      { hunks: [verdict("h1"), verdict("h3")] },
      // The exact hunk id a provider would once have copied is no longer a valid citation.
      { hunks: [verdict("h1"), verdict(userOwned.hunkId)] },
      { hunks: [verdict("h1"), verdict("h2", "maybe")] },
      // ADR-0604: a valid reference filed under another hunk's anchor names no single hunk.
      {
        hunks: [
          { ...verdict("h1"), anchor: anchors[1] },
          { ...verdict("h2"), anchor: anchors[0] },
        ],
      },
      { hunks: [{ ...verdict("h1"), anchor: null }, verdict("h2")] },
      { hunks: references.map((id) => ({ ...verdict(id), reason: "" })) },
      { hunks: references.map((id) => ({ ...verdict(id), reason: "r".repeat(401) })) },
      { hunks: references.map((id) => ({ ...verdict(id), extra: true })) },
      { hunks: references.map((id) => verdict(id)), agree: true },
    ])
      expect(contract.parse(invalid)).toBeNull();
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

  it("keeps a user-owned hunk a suggestion even after an agreement (AGENTS.md invariant 5)", () => {
    const settled = settleDocumentFreshnessCrossCheck(candidate([userOwned]), {
      ...reviewer,
      status: "verdicts",
      verdicts: [{ hunkId: userOwned.hunkId, verdict: "agree", reason: "ok" }],
    });
    expect(settled).toMatchObject({ state: "suggested", authorityRequired: "none" });
    expect(documentFreshnessAutoApplicableHunks(settled)).toEqual([]);
    expect(documentFreshnessUserOwnedChange(settled)).toBe(true);
    // A mixed candidate applies its managed hunk and keeps the user-owned one as the suggestion.
    const mixed = settleDocumentFreshnessCrossCheck(candidate([managed, userOwned]), {
      ...reviewer,
      status: "verdicts",
      verdicts: [
        { hunkId: managed.hunkId, verdict: "agree", reason: "ok" },
        { hunkId: userOwned.hunkId, verdict: "agree", reason: "ok" },
      ],
    });
    expect(mixed).toMatchObject({ state: "verified" });
    expect(documentFreshnessAutoApplicableHunks(mixed).map((item) => item.hunkId)).toEqual([
      managed.hunkId,
    ]);
    expect(documentFreshnessUserOwnedChange(mixed)).toBe(false);
    expect(documentFreshnessUserOwnedChange({ ...mixed, pendingHunkIds: [userOwned.hunkId] })).toBe(
      true,
    );
  });

  it("needs two independent agreements for a Lervo-managed safety hunk", () => {
    for (const required of [hunk({ changeClass: "safety_or_policy" })]) {
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
        archive: { ...archivePlan, ownership: "lervo_managed", inboundLinkRewrites: [] },
      }),
    ).toBe(true);
    // AGENTS.md invariant 5: bytes Lervo never applies need no call.
    expect(
      documentFreshnessCandidateNeedsCrossCheck({
        ...verified,
        operation: "archive",
        hunks: [],
        archive: archivePlan,
      }),
    ).toBe(false);
    expect(documentFreshnessCandidateNeedsCrossCheck({ ...verified, hunks: [userStatement] })).toBe(
      false,
    );
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
