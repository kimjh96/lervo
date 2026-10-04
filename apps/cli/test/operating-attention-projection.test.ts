import type { CanonicalizationCandidateInspection } from "@lervo/repository-knowledge";
import type { WorkstreamSnapshot } from "@lervo/schemas";
import { calculateRepositoryReplicaDivergenceId } from "@lervo/sync";
import { describe, expect, it } from "vitest";

import { createOperatingAttentionReport } from "../src/operating-attention-projection.js";

const workstream: WorkstreamSnapshot = {
  schemaVersion: 1,
  workstreamId: "wks_0123456789abcdef01234567",
  revision: 3,
  status: "blocked",
  title: "Attention fixture",
  objective: "Surface bounded action items.",
  nextActions: [],
  blockers: ["A current owner has not been assigned."],
  notes: [],
  references: [],
  pendingDecisions: [
    {
      decisionId: "wdec_0123456789abcdef",
      question: "Which current target should be used?",
      choices: [
        { choiceId: "first", label: "First", consequence: "Use the first target." },
        { choiceId: "second", label: "Second", consequence: "Use the second target." },
      ],
      recommendedChoiceId: "first",
      blocking: true,
    },
  ],
  pendingApprovals: [
    {
      approvalId: "wapr_0123456789abcdef",
      kind: "repository_bytes",
      summary: "Approve the exact canonical target bytes.",
      bindingHash: `sha256:${"a".repeat(64)}`,
      blocking: true,
    },
  ],
  origin: {
    kind: "created",
    sourceArtifactId: null,
    sourceContentHash: null,
    sourcePathDigest: null,
  },
  updatedAt: "2026-09-04T00:00:00.000Z",
};

function candidate(
  observedState: CanonicalizationCandidateInspection["observedState"],
): CanonicalizationCandidateInspection {
  return {
    schemaVersion: 1,
    candidateId: "kcanon_0123456789abcdef01234567",
    state: observedState === "stale" ? "candidate" : observedState,
    observedState,
    beforeRevision: `sha256:${"b".repeat(64)}`,
    afterRevision: `sha256:${"c".repeat(64)}`,
    sourceBindings: [
      {
        path: "apps/cli/src/example.ts",
        beforeHash: `sha256:${"d".repeat(64)}`,
        afterHash: `sha256:${"e".repeat(64)}`,
        responsibility: "architecture_or_specification",
      },
    ],
    recommendedRoots: ["docs/specs"],
    createdAt: "2026-09-04T00:00:00.000Z",
    review: null,
    promotion: null,
    contentHash: `sha256:${"f".repeat(64)}`,
  };
}

describe("operating attention projection", () => {
  it("prioritizes typed user authority and keeps stale and maintenance states distinct", () => {
    const report = createOperatingAttentionReport({
      projectId: "prj_0123456789abcdef",
      workstream,
      canonicalization: { coverage: "complete", candidates: [candidate("stale")] },
      knowledgeLifecycle: {
        coverage: "cached",
        issues: [
          {
            code: "document_normalization_pending",
            command: "lervo migrate knowledge --provider codex",
          },
        ],
      },
      observedAt: new Date("2026-09-04T00:01:00.000Z"),
    });

    expect(report).toMatchObject({
      status: "action_required",
      coverage: { workstream: "current", knowledgeLifecycle: "cached" },
      summary: { totalCount: 5, blockingCount: 3, userActionCount: 2, staleCount: 1 },
    });
    expect(report.items.slice(0, 2).map((item) => item.kind)).toEqual([
      "workstream_approval",
      "workstream_decision",
    ]);
    expect(report.items.find((item) => item.kind === "canonicalization_review")).toMatchObject({
      state: "stale",
      actionOwner: "reviewer",
      requiresUserAction: false,
      sourcePaths: ["apps/cli/src/example.ts"],
      outcomeKind: null,
      proposedTargetPaths: [],
      hasProposedContent: false,
    });
    // Normalization debt is agent work in every repository-changing turn, never a reviewer queue.
    expect(report.items.find((item) => item.kind === "knowledge_lifecycle")).toMatchObject({
      actionOwner: "agent",
      requiresUserAction: false,
      issueCode: "document_normalization_pending",
    });
  });

  it("excludes terminal canonicalization states and keeps the digest independent of observation time", () => {
    const first = createOperatingAttentionReport({
      projectId: "prj_0123456789abcdef",
      workstream: null,
      canonicalization: { coverage: "complete", candidates: [candidate("promoted")] },
      knowledgeLifecycle: { coverage: "cached", issues: [] },
      observedAt: new Date("2026-09-04T00:01:00.000Z"),
    });
    const second = createOperatingAttentionReport({
      projectId: "prj_0123456789abcdef",
      workstream: null,
      canonicalization: { coverage: "complete", candidates: [candidate("promoted")] },
      knowledgeLifecycle: { coverage: "cached", issues: [] },
      observedAt: new Date("2026-09-04T00:02:00.000Z"),
    });

    expect(first.status).toBe("current");
    expect(first.items).toEqual([]);
    expect(first.reportDigest).toBe(second.reportDigest);
    expect(first.limitations).toContain(
      "Unavailable source coverage is unknown, not current or empty.",
    );
  });

  it("treats an unavailable source as action required instead of an empty success", () => {
    const report = createOperatingAttentionReport({
      projectId: "prj_0123456789abcdef",
      workstream: null,
      canonicalization: { coverage: "unavailable", candidates: [] },
      knowledgeLifecycle: { coverage: "unavailable", issues: [] },
      observedAt: new Date("2026-09-04T00:01:00.000Z"),
    });

    expect(report).toMatchObject({
      status: "action_required",
      coverage: {
        workstream: "missing",
        canonicalization: "unavailable",
        knowledgeLifecycle: "unavailable",
      },
      summary: { totalCount: 0 },
    });
  });

  it("projects one user-owned item for an open repository replica divergence", () => {
    const localSnapshotHash = `sha256:${"a".repeat(64)}`;
    const peerSnapshotHash = `sha256:${"b".repeat(64)}`;
    const divergence = {
      divergenceId: calculateRepositoryReplicaDivergenceId(localSnapshotHash, peerSnapshotHash),
      replicaId: "project",
      localSnapshotHash,
      peerSnapshotHash,
      commonSnapshotHash: null,
      reason: "conflicting_paths" as const,
      conflictPathCount: 1,
      conflictPaths: ["source.ts"],
      openedAt: "2026-10-05T00:00:00.000Z",
    };
    const report = createOperatingAttentionReport({
      projectId: "prj_0123456789abcdef",
      workstream: null,
      canonicalization: { coverage: "complete", candidates: [] },
      knowledgeLifecycle: { coverage: "cached", issues: [] },
      repositoryReplicaDivergence: divergence,
      observedAt: new Date("2026-10-05T00:01:00.000Z"),
    });

    expect(report.status).toBe("action_required");
    expect(report.items).toEqual([
      expect.objectContaining({
        kind: "repository_replica_divergence",
        divergenceId: divergence.divergenceId,
        actionOwner: "user",
        requiresUserAction: true,
        conflictPaths: ["source.ts"],
      }),
    ]);
    expect(report.items[0]!.instruction).toContain("--replica project --prefer local|peer");
  });

  it("projects draft availability and target coordinates without exposing proposed content", () => {
    const withDraft = candidate("pending");
    withDraft.outcome = {
      schemaVersion: 1,
      kind: "review_draft",
      summary: "Update the execution contract.",
      drafts: [
        {
          targetPath: "docs/specs/execution.md",
          sourcePaths: ["apps/cli/src/example.ts"],
          proposedMarkdown: "PRIVATE PROPOSED CONTENT",
          proposedContentHash: `sha256:${"1".repeat(64)}`,
        },
      ],
    };
    const report = createOperatingAttentionReport({
      projectId: "prj_0123456789abcdef",
      workstream: null,
      canonicalization: { coverage: "complete", candidates: [withDraft] },
      knowledgeLifecycle: { coverage: "cached", issues: [] },
      observedAt: new Date("2026-09-04T00:01:00.000Z"),
    });

    expect(report.items[0]).toMatchObject({
      outcomeKind: "review_draft",
      proposedTargetPaths: ["docs/specs/execution.md"],
      hasProposedContent: true,
    });
    expect(JSON.stringify(report)).not.toContain("PRIVATE PROPOSED CONTENT");
  });
});
