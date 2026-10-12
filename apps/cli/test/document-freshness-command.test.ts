import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type { DocumentFreshnessCandidateV1 } from "@lervo/repository-knowledge";
import { afterEach, describe, expect, it } from "vitest";

import { documentFreshnessAttentionItems } from "../src/document-freshness-attention.js";
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
        authorityRequired: "owner",
        crossCheckRequired: true,
        claims: [],
      },
    ],
    archive: null,
    explanation: null,
    reasonsAddressed: ["reference_target_missing"],
    authorityRequired: "owner",
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

describe("document freshness owner surfaces", () => {
  it("projects waiting, applied, and blocked freshness state as ADR-0463 attention items", () => {
    const applied = candidate({
      candidateId: "kfresh_bbbbbbbbbbbbbbbbbbbbbbbb",
      documentPath: "AGENTS.md",
      state: "applied",
      approval: {
        approvalSource: "lervo_managed",
        approvalRef: afterHash,
        reviewer: null,
        approvedAt: "2026-10-05T00:00:00.000Z",
      },
      commitHash: "c".repeat(40),
    });
    const items = documentFreshnessAttentionItems({
      awaiting: [candidate({})],
      applied: [applied],
      blocked: { attempts: 5 },
    });
    expect(
      items.map((item) => [item.kind, item.actionOwner, item.requiresUserAction, item.blocking]),
    ).toEqual([
      ["document_freshness_candidate", "user", true, false],
      ["document_freshness_applied", "agent", false, false],
      ["document_freshness_blocked", "user", true, false],
    ]);
    expect(items[0]!.instruction).toContain(
      `lervo knowledge freshness apply kfresh_aaaaaaaaaaaaaaaaaaaaaaaa --approval ${afterHash}`,
    );
    const report = createOperatingAttentionReport({
      projectId: "prj_freshness_fixture",
      workstream: null,
      workstreamFreshness: null,
      canonicalization: { coverage: "complete", candidates: [] },
      knowledgeLifecycle: { coverage: "complete", issues: [] },
      documentFreshness: { awaiting: [candidate({})], applied: [applied], blocked: null },
      observedAt: new Date("2026-10-05T01:00:00.000Z"),
    });
    expect(report.summary).toMatchObject({ totalCount: 2, userActionCount: 1, blockingCount: 0 });
    expect(formatOperatingAttention(report)).toContain(
      "document_freshness_candidate document_freshness_kfresh_aaaaaaaaaaaaaaaaaaaaaaaa · owner user · verified_pending_cross_check · README.md · entrypoint · factual_reference · hunks 1",
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
      "Document freshness: 1 stale (1 safety: AGENTS.md), 1 candidate awaits review; lervo knowledge freshness review";
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
    expect(output).toBe("Document freshness review: no candidate awaits the owner.\n");
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
    expect(output).toContain("Document freshness requires status, review, apply");
  });
});
