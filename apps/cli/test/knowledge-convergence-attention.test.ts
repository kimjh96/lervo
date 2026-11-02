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
      // ADR-0561: Lervo retries a failed check itself; it is never owner work.
      actionOwner: "agent",
      requiresUserAction: false,
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

it("names the recorded Hub failure cause and its exact remediation", () => {
  const forbidden = {
    ...verdict("unverifiable"),
    holder: null,
    failureCode: "hub_forbidden" as const,
    httpStatus: 403,
  };
  const [item] = knowledgeConvergenceAttentionItems({
    owner: { schemaVersion: 1, recordedHolderKey: null, verdict: forbidden },
    publication: null,
    hubScope: { projectId: "prj_attention_fixture", destinationId: "hub:wsl" },
  });
  expect(item).toMatchObject({
    kind: "knowledge_convergence_owner",
    reason: "convergence_owner_unverifiable",
    failureCode: "hub_forbidden",
    httpStatus: 403,
  });
  expect(item!.instruction).toBe(
    "The Hub refused this host's convergence owner token (HTTP 403). Grant workspace.read and workspace.coordinate for project prj_attention_fixture at Hub destination hub:wsl to the Hub principal that owns the token in this host's bearerTokenFile, then run lervo knowledge convergence owner status.",
  );
  const report = createOperatingAttentionReport({
    projectId: "prj_attention_fixture",
    workstream: null,
    workstreamFreshness: null,
    canonicalization: { coverage: "complete", candidates: [] },
    knowledgeLifecycle: { coverage: "complete", issues: [] },
    knowledgeConvergence: {
      owner: { schemaVersion: 1, recordedHolderKey: null, verdict: forbidden },
      publication: null,
    },
    observedAt: new Date("2026-10-05T00:11:00.000Z"),
  });
  expect(formatOperatingAttention(report)).toContain(
    "unverifiable · convergence_owner_unverifiable · hub_forbidden HTTP 403",
  );

  const instructions = new Map<string, string>();
  for (const failureCode of [
    "hub_unauthorized",
    "hub_unreachable",
    "hub_identity_mismatch",
    "hub_response_invalid",
    "hub_configuration_invalid",
    "token_file_unreadable",
    "hub_request_failed",
  ] as const) {
    const [projected] = knowledgeConvergenceAttentionItems({
      owner: {
        schemaVersion: 1,
        recordedHolderKey: null,
        verdict: { ...forbidden, failureCode, httpStatus: null },
      },
      publication: null,
    });
    expect(projected).toMatchObject({ failureCode, httpStatus: null });
    instructions.set(failureCode, projected!.instruction);
  }
  expect(new Set(instructions.values()).size).toBe(instructions.size);
  expect(instructions.get("hub_unauthorized")).toContain("Replace the token");
  expect(instructions.get("token_file_unreadable")).toContain("mode 0600");

  // A fence written before failure causes existed projects no cause and the generic step.
  const [legacy] = knowledgeConvergenceAttentionItems({
    owner: { schemaVersion: 1, recordedHolderKey: null, verdict: verdict("unverifiable") },
    publication: null,
  });
  expect(legacy).toMatchObject({ failureCode: null, httpStatus: null });
  expect(legacy!.instruction).toBe(instructions.get("hub_request_failed"));
});

it("projects a superseded publication as one attention item with its conflict count", () => {
  const items = knowledgeConvergenceAttentionItems({
    owner: null,
    publication: {
      ...failedPublication,
      status: "superseded",
      pullRequestNumber: null,
      pullRequestUrl: null,
      failure: {
        code: "knowledge_publication_superseded",
        detail:
          "3 conflicting path(s) in 8 commit(s); local base reset to the remote base and convergence requeued; backup refs/lervo/knowledge-superseded/9f01e8e8aaaa",
        firstObservedAt: "2026-10-05T00:05:00.000Z",
        lastObservedAt: "2026-10-05T00:05:00.000Z",
        occurrences: 1,
      },
    },
  });
  expect(items).toMatchObject([
    {
      kind: "knowledge_publication",
      failureCode: "knowledge_publication_superseded",
      detail: expect.stringContaining("3 conflicting path(s)"),
      pullRequestUrl: null,
    },
  ]);
  expect(items[0]!.instruction).toContain("convergence regenerates the outputs");
});

it("shows the gh step, exit code, and failure class with a class-specific remediation", () => {
  const publication = {
    ...failedPublication,
    failure: {
      ...failedPublication.failure,
      code: "knowledge_publication_pull_request_failed" as const,
      detail: "gh update exit 1 auth",
    },
  };
  const [item] = knowledgeConvergenceAttentionItems({ owner: null, publication });
  expect(item).toMatchObject({
    kind: "knowledge_publication",
    failureCode: "knowledge_publication_pull_request_failed",
    detail: "gh update exit 1 auth",
    // Only credentials Lervo cannot create stay with the owner.
    requiresUserAction: true,
  });
  expect(item!.instruction).toContain("gh auth status");
  const report = createOperatingAttentionReport({
    projectId: "prj_attention_fixture",
    workstream: null,
    workstreamFreshness: null,
    canonicalization: { coverage: "complete", candidates: [] },
    knowledgeLifecycle: { coverage: "complete", issues: [] },
    knowledgeConvergence: { owner: null, publication },
    observedAt: new Date("2026-10-05T00:11:00.000Z"),
  });
  expect(formatOperatingAttention(report)).toContain(
    "knowledge_publication_pull_request_failed · gh update exit 1 auth · occurrences 2",
  );
  const [unclassified] = knowledgeConvergenceAttentionItems({
    owner: null,
    publication: {
      ...publication,
      failure: { ...publication.failure, detail: "gh update exit 1 unknown" },
    },
  });
  expect(unclassified!.instruction).toContain("Check that gh is installed and authenticated");
  expect(unclassified!.requiresUserAction).toBe(false);
});

it("projects superseded knowledge commits a checkout could not drop as one attention item", () => {
  const supersession = {
    schemaVersion: 1 as const,
    entries: [],
    held: {
      reason: "under_other_work" as const,
      commitCount: 2,
      observedAt: "2026-10-05T00:20:00.000Z",
    },
    lastDrop: null,
  };
  const [item, ...rest] = knowledgeConvergenceAttentionItems({
    owner: null,
    publication: null,
    supersession,
  });
  expect(rest).toEqual([]);
  expect(item).toMatchObject({
    kind: "knowledge_publication",
    itemId: "knowledge_publication_knowledge_supersession_held",
    failureCode: "knowledge_supersession_held",
    detail: "2 superseded commit(s) held: under_other_work",
    firstObservedAt: "2026-10-05T00:20:00.000Z",
    occurrences: 1,
    requiresUserAction: true,
  });
  expect((item as { instruction: string }).instruction).toContain("Rebase the branch");
  expect(
    knowledgeConvergenceAttentionItems({
      owner: null,
      publication: null,
      supersession: { ...supersession, held: null },
    }),
  ).toEqual([]);
});
