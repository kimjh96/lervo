import { expect, it } from "vitest";

import { knowledgeConvergenceAttentionItems } from "../src/knowledge-convergence-attention.js";
import { formatOperatingAttention } from "../src/operating-attention-format.js";
import { createOperatingAttentionReport } from "../src/operating-attention-projection.js";

const verdict = (role: "owner" | "unverifiable" | "contended") => ({
  role,
  reason:
    role === "owner"
      ? ("lease_renewed" as const)
      : role === "contended"
        ? ("convergence_owner_contended" as const)
        : ("convergence_owner_unverifiable" as const),
  mode: "hub" as const,
  hostHash: `sha256:${"1".repeat(64)}`,
  hostLabel: "mac",
  holder: { hostHash: `sha256:${"2".repeat(64)}`, label: "wsl", generation: 3, expiresAt: null },
  validUntil: null,
  wakeAt: null,
  grantedAt: null,
  yieldUntil: null,
  observedAt: "2026-10-05T00:00:00.000Z",
});

const failedPublication = {
  schemaVersion: 1 as const,
  status: "failed" as const,
  pullRequestNumber: 7,
  pullRequestUrl: "https://example.invalid/pull/7",
  publishedHead: "a".repeat(40),
  commitCount: 2,
  updatedAt: "2026-10-05T00:10:00.000Z",
  failure: {
    code: "knowledge_publication_checks_failed" as const,
    detail: "1 of 3 checks failed",
    firstObservedAt: "2026-10-05T00:05:00.000Z",
    lastObservedAt: "2026-10-05T00:10:00.000Z",
    occurrences: 2,
  },
};

it("projects one ownership item and one publication item, and nothing for a healthy owner", () => {
  expect(
    knowledgeConvergenceAttentionItems({
      owner: { schemaVersion: 1, recordedHolderKey: null, verdict: verdict("owner") },
      publication: { ...failedPublication, status: "merged", failure: null },
    }),
  ).toEqual([]);
  const items = knowledgeConvergenceAttentionItems({
    owner: { schemaVersion: 1, recordedHolderKey: null, verdict: verdict("contended") },
    publication: failedPublication,
  });
  expect(items).toMatchObject([
    {
      kind: "knowledge_convergence_owner",
      role: "contended",
      holderLabel: "wsl",
      requiresUserAction: true,
    },
    {
      kind: "knowledge_publication",
      itemId: "knowledge_publication_knowledge_publication_checks_failed",
      failureCode: "knowledge_publication_checks_failed",
      occurrences: 2,
      pullRequestUrl: "https://example.invalid/pull/7",
    },
  ]);
  const report = createOperatingAttentionReport({
    projectId: "prj_attention_fixture",
    workstream: null,
    workstreamFreshness: null,
    canonicalization: { coverage: "complete", candidates: [] },
    knowledgeLifecycle: { coverage: "complete", issues: [] },
    knowledgeConvergence: { owner: null, publication: failedPublication },
    observedAt: new Date("2026-10-05T00:11:00.000Z"),
  });
  expect(report.items).toHaveLength(1);
  expect(formatOperatingAttention(report)).toContain(
    "knowledge_publication_checks_failed · 1 of 3 checks failed · occurrences 2",
  );
});
