import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type { DocumentFreshnessCandidateV1 } from "@lervo/repository-knowledge";
import { afterEach, describe, expect, it } from "vitest";

import { documentFreshnessAttentionItems } from "../src/document-freshness-attention.js";
import {
  formatDocumentFreshnessCandidate,
  formatDocumentFreshnessReview,
} from "../src/knowledge-freshness-format.js";
import { runCli } from "../src/main.js";
import { formatOperatingAttention } from "../src/operating-attention-format.js";
import { createOperatingAttentionReport } from "../src/operating-attention-projection.js";
import { formatCompactTerminalPreamble } from "../src/terminal-compact-format.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const afterHash = `sha256:${"7".repeat(64)}`;

function candidate(overrides: Partial<DocumentFreshnessCandidateV1>): DocumentFreshnessCandidateV1 {
  return {
    schemaVersion: 1,
    candidateId: "kfresh_aaaaaaaaaaaaaaaaaaaaaaaa",
    generationId: "kfg_aaaaaaaaaaaaaaaaaaaaaaaa",
    findingDigest: `sha256:${"1".repeat(64)}`,
    bundleHash: `sha256:${"2".repeat(64)}`,
    documentPath: "README.md",
    sourceHash: `sha256:${"3".repeat(64)}`,
    priorityClass: "entrypoint",
    operation: "edit",
    hunks: [
      {
        hunkId: "kfh_aaaaaaaaaaaaaaaa",
        range: { startByte: 0, endByte: 4 },
        beforeHash: `sha256:${"4".repeat(64)}`,
        replacement: "v4",
        changeClass: "factual_reference",
        ownership: "user_owned",
        managedBlockId: null,
        authorityRequired: "none",
        crossCheckRequired: true,
        claims: [],
      },
    ],
    archive: null,
    explanation: null,
    reasonsAddressed: ["reference_target_missing"],
    authorityRequired: "none",
    state: "verified_pending_cross_check",
    checks: [],
    crossCheck: "unavailable",
    evidenceCount: 1,
    evidenceTruncated: false,
    beforeBytesRef: null,
    afterHash,
    appliedHash: null,
    appliedHunkIds: [],
    pendingHunkIds: ["kfh_aaaaaaaaaaaaaaaa"],
    tokensObserved: 1500,
    rejection: null,
    approval: null,
    commitHash: null,
    acknowledgedAt: null,
    detectedAt: "2026-10-05T00:00:00.000Z",
    createdAt: "2026-10-05T00:00:00.000Z",
    updatedAt: "2026-10-05T00:00:00.000Z",
    ...overrides,
  };
}

const unavailableReview = {
  status: "settled" as const,
  inputHash: `sha256:${"5".repeat(64)}`,
  runId: "run_freshness_eeeeeeeeeeeeeeeeeeeeeeee",
  reviewerProvider: "claude" as const,
  outcome: "unavailable" as const,
  unavailableReason: "cross_check_response_invalid" as const,
  verdicts: [],
  tokensObserved: 900,
  deferrals: 0,
  settledAt: "2026-10-05T00:10:00.000Z",
};

describe("document freshness surfaces without the owner (ADR-0561)", () => {
  it("projects held, applied, zero-success, and debt state without any owner action", () => {
    const applied = candidate({
      candidateId: "kfresh_bbbbbbbbbbbbbbbbbbbbbbbb",
      documentPath: "AGENTS.md",
      state: "applied",
      crossCheck: "agreement",
      crossCheckReview: {
        ...unavailableReview,
        outcome: "agreement",
        unavailableReason: null,
        verdicts: [
          { hunkId: "kfh_aaaaaaaaaaaaaaaa", verdict: "agree", reason: "Evidence shows v4." },
        ],
      },
      approval: {
        approvalSource: "lervo_managed",
        approvalRef: afterHash,
        reviewer: "cross_check run_freshness_eeeeeeeeeeeeeeeeeeeeeeee",
        approvedAt: "2026-10-05T00:00:00.000Z",
      },
      commitHash: "c".repeat(40),
    });
    const held = candidate({ crossCheckReview: unavailableReview });
    const debt = {
      findingDigest: `sha256:${"6".repeat(64)}`,
      documentPath: "docs/guide.md",
      candidateId: "kfresh_dddddddddddddddddddddddd",
      reason: "cross_check_disagreement_repeated" as const,
      since: "2026-10-04T00:00:00.000Z",
      attempts: 1,
      retryAt: "2026-10-06T00:00:00.000Z",
    };
    const input = {
      held: [held],
      applied: [applied],
      zeroSuccessHold: {
        since: "2026-10-05T00:00:00.000Z",
        until: "2026-10-05T01:00:00.000Z",
        attempts: 5,
      },
      debt: [
        debt,
        { ...debt, reason: "freshness_evidence_undetermined" as const, documentPath: "a.md" },
        { ...debt, reason: "budget_exceeded" as const, documentPath: "b.md" },
      ],
    };
    const items = documentFreshnessAttentionItems(input);
    expect(
      items.map((item) => [item.kind, item.state, item.actionOwner, item.requiresUserAction]),
    ).toEqual([
      ["document_freshness_candidate", "lervo_debt", "host resident", false],
      ["document_freshness_applied", "applied", "agent", false],
      ["document_freshness_blocked", "lervo_debt", "host resident", false],
      ["document_freshness_blocked", "lervo_debt", "host resident", false],
      ["document_freshness_blocked", "lervo_debt", "host resident", false],
      ["document_freshness_blocked", "lervo_debt", "host resident", false],
    ]);
    expect(items.every((item) => !item.requiresUserAction && !item.blocking)).toBe(true);
    expect(items.map((item) => item.instruction).join("\n")).not.toMatch(
      /freshness apply|--approval/u,
    );
    expect(items[0]).toMatchObject({
      heldReason: "cross_check_response_invalid",
      retryAt: "2026-10-05T01:10:00.000Z",
    });
    // The applied notice names the document, the reason, the cross-check, and the undo.
    expect(items[1]!.instruction).toBe(
      "Lervo refreshed AGENTS.md (reason reference_target_missing; cross-check agreement 1/1 (claude run_freshness_eeeeeeeeeeeeeeeeeeeeeeee)); mention it in the turn report. Undo with lervo knowledge freshness revert kfresh_bbbbbbbbbbbbbbbbbbbbbbbb, or acknowledge with lervo knowledge freshness acknowledge kfresh_bbbbbbbbbbbbbbbbbbbbbbbb.",
    );
    expect(items.slice(2).map((item) => (item as { reasonCode: string }).reasonCode)).toEqual([
      "zero_success_window",
      "cross_check_disagreement_repeated",
      "freshness_evidence_undetermined",
      "budget_exceeded",
    ]);
    const report = createOperatingAttentionReport({
      projectId: "prj_freshness_fixture",
      workstream: null,
      workstreamFreshness: null,
      canonicalization: { coverage: "complete", candidates: [] },
      knowledgeLifecycle: { coverage: "complete", issues: [] },
      documentFreshness: input,
      observedAt: new Date("2026-10-05T00:30:00.000Z"),
    });
    expect(report.summary).toMatchObject({ totalCount: 6, userActionCount: 0, blockingCount: 0 });
    expect(report.items.every((item) => item.requiresUserAction === false)).toBe(true);
    expect(formatOperatingAttention(report)).toContain(
      "document_freshness_candidate document_freshness_kfresh_aaaaaaaaaaaaaaaaaaaaaaaa · owner resident freshness cycle · lervo_debt · README.md · entrypoint · factual_reference · hunks 1 · cross_check_response_invalid",
    );
  });

  it("shows held candidates and cross-check rounds for inspection only", () => {
    const agreed = candidate({
      state: "applied",
      crossCheck: "agreement",
      crossCheckRounds: [{ ...unavailableReview, outcome: "agreement", unavailableReason: null }],
      crossCheckReview: { ...unavailableReview, outcome: "agreement", unavailableReason: null },
    });
    const text = formatDocumentFreshnessCandidate(agreed, "");
    expect(text).toContain(
      "cross-check agreement · earlier agreeing rounds 1 · reviewer claude · run run_freshness_eeeeeeeeeeeeeeeeeeeeeeee",
    );
    expect(text).toContain(
      "Undo: lervo knowledge freshness revert kfresh_aaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(text).not.toContain("--approval");
    expect(
      formatDocumentFreshnessReview([
        {
          ...candidate({ crossCheckReview: unavailableReview }),
          retryAt: "2026-10-05T01:10:00.000Z",
        },
      ]),
    ).toContain(
      "cross-check unavailable (cross_check_response_invalid) · Lervo retries at 2026-10-05T01:10:00.000Z",
    );
  });

  it("adds the bounded freshness line to the compact preamble only when present", () => {
    const attention = createOperatingAttentionReport({
      projectId: "prj_freshness_fixture",
      workstream: null,
      workstreamFreshness: null,
      canonicalization: { coverage: "complete", candidates: [] },
      knowledgeLifecycle: { coverage: "unavailable", issues: [] },
      observedAt: new Date("2026-10-05T01:00:00.000Z"),
    });
    const base = {
      publicationLanguage: "en",
      attention,
      declarationInstruction: "Declare the turn.",
      backgroundKnowledgeActive: true,
      workstreamPresent: false,
      staleWorkstreamEntryCount: 0,
    };
    const line =
      "Document freshness (no owner action): 1 stale (1 safety: AGENTS.md), 1 candidate held by Lervo; lervo knowledge freshness status";
    expect(formatCompactTerminalPreamble({ ...base, documentFreshnessLine: line })).toContain(
      `\n${line}\n`,
    );
    expect(formatCompactTerminalPreamble(base)).not.toContain("Document freshness");
  });

  it("reports empty status and review for an initialized repository", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-freshness-cli-"));
    roots.push(root);
    let output = "";
    const io = {
      cwd: root,
      stdout: (message: string) => {
        output += message;
      },
      stderr: (message: string) => {
        output += message;
      },
    };
    expect(await runCli(["init"], io)).toBe(0);
    output = "";
    expect(await runCli(["knowledge", "freshness", "status", "--json"], io)).toBe(0);
    expect(JSON.parse(output)).toMatchObject({
      kind: "document_freshness.status",
      enabled: true,
      oldestOpen: null,
      budget: { maximumTokensPerDay: 150_000 },
    });
    output = "";
    expect(await runCli(["knowledge", "freshness", "review"], io)).toBe(0);
    expect(output).toBe("Document freshness review: Lervo holds no candidate.\n");
    // ADR-0561 removed the owner approval and rejection commands; undo stays.
    for (const removed of [
      ["apply", "kfresh_cccccccccccccccccccccccc", "--approval", afterHash],
      ["reject", "kfresh_cccccccccccccccccccccccc", "--reason", "not_stale"],
    ]) {
      output = "";
      expect(await runCli(["knowledge", "freshness", ...removed], io)).toBe(1);
      expect(output).toContain(`Freshness ${removed[0]} was removed`);
      expect(output).toContain("lervo knowledge freshness revert <candidate-id>");
    }
    output = "";
    expect(
      await runCli(
        ["knowledge", "freshness", "apply", "kfresh_cccccccccccccccccccccccc", "--json"],
        io,
      ),
    ).toBe(1);
    expect(output).toContain('"status": "failed"');
    output = "";
    expect(await runCli(["knowledge", "freshness", "rewrite"], io)).toBe(1);
    expect(output).toContain("Document freshness requires status, review, revert, acknowledge");
  });
});
