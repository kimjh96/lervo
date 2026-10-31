import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  assessWorkstreamFreshness,
  documentDriftAttentionIssues,
  type KnowledgeLintIssue,
} from "@lervo/repository-knowledge";
import type { WorkstreamSnapshot } from "@lervo/schemas";
import { afterEach, describe, expect, it } from "vitest";

import { formatTerminalAttentionContext } from "../src/operating-attention-format.js";
import { createOperatingAttentionReport } from "../src/operating-attention-projection.js";
import {
  readTerminalKnowledgeLifecycleCache,
  readTerminalKnowledgeLifecycleCacheEntry,
  writeTerminalKnowledgeLifecycleCache,
} from "../src/terminal-knowledge-lifecycle-cache.js";
import { MAXIMUM_TERMINAL_ATTENTION_BYTES } from "../src/terminal-context-budget.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** Models Argo: entrypoints and design documents drifting from a removed v2 tree. */
function argoDriftLint(count: number): { issues: KnowledgeLintIssue[] } {
  return {
    issues: [
      {
        code: "entrypoint_reference_missing",
        severity: "warning",
        path: "AGENTS.md",
        target: "v2/argo_v2/live/engine.py",
        reasons: ["path_missing"],
        message: "Line 3 references v2/argo_v2/live/engine.py, which does not exist.",
      },
      ...Array.from({ length: count }, (_, index) => ({
        code: "document_stale",
        severity: "warning" as const,
        path: `docs/design-${String(index).padStart(3, "0")}.md`,
        target: "v2/argo_v2/live/engine.py",
        reasons: ["connected_path_changed"],
        message: "stale",
      })),
      {
        code: "document_normalization_stale",
        severity: "warning",
        path: "docs/other.md",
        message: "not a drift code",
      },
    ],
  };
}

const workstream: WorkstreamSnapshot = {
  schemaVersion: 1,
  workstreamId: "wks_0123456789abcdef01234567",
  revision: 3,
  status: "active",
  title: "Drift fixture",
  objective: "Keep documents current.",
  nextActions: [],
  blockers: ["An old blocker."],
  notes: [],
  references: [],
  pendingDecisions: [],
  pendingApprovals: [],
  origin: {
    kind: "created",
    sourceArtifactId: null,
    sourceContentHash: null,
    sourcePathDigest: null,
  },
  updatedAt: "2026-09-01T00:00:00.000Z",
};

describe("document drift attention", () => {
  it("caches drift as advisories that never change the lifecycle gate", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-drift-attention-"));
    roots.push(root);
    const coordinates = {
      root,
      repositoryRevision: `sha256:${"a".repeat(64)}`,
      supplementalSources: [],
    };
    const advisories = documentDriftAttentionIssues(argoDriftLint(10), 4);
    expect(advisories.map((item) => item.code)).toEqual([
      "entrypoint_reference_missing",
      "document_stale",
      "document_stale",
      "document_stale",
      "document_drift_attention_truncated",
    ]);
    await writeTerminalKnowledgeLifecycleCache({ ...coordinates, issues: [], advisories });
    await expect(readTerminalKnowledgeLifecycleCache(coordinates)).resolves.toEqual([]);
    await expect(readTerminalKnowledgeLifecycleCacheEntry(coordinates)).resolves.toEqual({
      issues: [],
      advisories,
    });
  });

  it("keeps entrypoint and staleness findings visible when many role findings exist", () => {
    const roles = Array.from({ length: 10 }, (_, index) => ({
      code: "document_role_target_missing",
      severity: "warning" as const,
      path: `IMPLEMENTATION-HANDOFF/${index}.md`,
      message: "missing",
    }));
    const lint = argoDriftLint(1);
    const items = documentDriftAttentionIssues({ issues: [...roles, ...lint.issues] }, 4);
    expect(items.map((item) => item.code)).toEqual([
      "entrypoint_reference_missing",
      "document_stale",
      "document_role_target_missing",
      "document_role_target_missing",
      "document_drift_attention_truncated",
    ]);
  });

  it("projects agent-owned, non-blocking items within the terminal byte cap beside stale workstream items", () => {
    const advisories = documentDriftAttentionIssues(argoDriftLint(10), 4);
    const report = createOperatingAttentionReport({
      projectId: "prj_0123456789abcdef",
      workstream,
      workstreamFreshness: assessWorkstreamFreshness({
        snapshot: workstream,
        headDistance: { status: "not_recorded" },
        observedAt: new Date("2026-10-05T00:00:00.000Z"),
      }),
      canonicalization: { coverage: "complete", candidates: [] },
      knowledgeLifecycle: {
        coverage: "cached",
        issues: [
          { code: "document_normalization_pending", command: "lervo migrate knowledge" },
          ...advisories,
        ],
      },
      observedAt: new Date("2026-10-05T00:00:00.000Z"),
    });
    const drift = report.items.filter(
      (item) =>
        item.kind === "knowledge_lifecycle" && item.issueCode !== "document_normalization_pending",
    );
    expect(drift).toHaveLength(5);
    for (const item of drift)
      expect(item).toMatchObject({
        actionOwner: "agent",
        requiresUserAction: false,
        blocking: false,
        state: "action_required",
        recordedInstruction: "lervo knowledge lint --json",
      });
    expect(report.items.find((item) => item.kind === "workstream_blocker")?.state).toBe("stale");
    expect(report.summary.userActionCount).toBe(0);

    const context = formatTerminalAttentionContext(report);
    expect(Buffer.byteLength(context)).toBeLessThanOrEqual(MAXIMUM_TERMINAL_ATTENTION_BYTES);
    expect(context).toContain("document_normalization_pending");
    expect(context).toContain("document_stale · path=docs/design-000.md");
    expect(context).not.toContain("present its bounded question");
    expect(context).not.toContain(tmpdir());
  });
});
