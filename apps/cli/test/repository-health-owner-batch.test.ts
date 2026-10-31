import { assessWorkstreamFreshness } from "@lervo/repository-knowledge";
import type { WorkstreamSnapshot } from "@lervo/schemas";
import { expect, it } from "vitest";
import { createOperatingAttentionReport } from "../src/operating-attention-projection.js";
import { formatCompactTerminalPreamble } from "../src/terminal-compact-format.js";
import { mergeCurrentOwnerAttention } from "../src/repository-health-owner-review.js";
import { unknownRepositoryHealth } from "../src/repository-health-reader.js";
import { healthNow, healthRevision, healthyProjection } from "./repository-health-fixture.js";

const workstream: WorkstreamSnapshot = {
  schemaVersion: 1,
  workstreamId: "wks_0123456789abcdef01234567",
  revision: 1,
  status: "active",
  title: "Owner approval",
  objective: "Preserve current authority requests",
  nextActions: [],
  blockers: [],
  notes: [],
  references: [],
  pendingApprovals: [
    {
      approvalId: "wapr_0123456789abcdef",
      kind: "deployment",
      summary: "Deploy exact binding",
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
  updatedAt: healthNow.toISOString(),
};
const report = (
  health = unknownRepositoryHealth(healthRevision, healthNow, "projection_missing_or_unreadable"),
  snapshot = workstream,
) =>
  createOperatingAttentionReport({
    projectId: "prj_health",
    workstream: snapshot,
    workstreamFreshness: assessWorkstreamFreshness({
      snapshot,
      headDistance: { status: "not_recorded" },
      observedAt: healthNow,
    }),
    canonicalization: { coverage: "complete", candidates: [] },
    knowledgeLifecycle: { coverage: "unavailable", issues: [] },
    health,
    observedAt: healthNow,
  });

it.each(["projection_missing_or_unreadable", "projection_revision_changed", "projection_stale"])(
  "keeps currently read approvals when cache is %s",
  (reason) => {
    const attention = report(unknownRepositoryHealth(healthRevision, healthNow, reason));
    const text = formatCompactTerminalPreamble({
      publicationLanguage: "en",
      attention,
      declarationInstruction: "Declare",
      backgroundKnowledgeActive: false,
      workstreamPresent: true,
      staleWorkstreamEntryCount: 0,
    });
    expect(text).toContain("needs owner authority (at least 1)");
    expect(text).toContain("wapr_0123456789abcdef");
    expect(text.match(/needs owner authority/gu)).toHaveLength(1);
    expect(text).toContain("lervo workstream current --context");
  },
);

it("deduplicates current and cached approvals and removes resolved cached workstream requests", () => {
  const projection = healthyProjection();
  const attention = report();
  projection.measures.ownerReview.status = "gap";
  projection.measures.ownerReview.value = {
    count: 1,
    confirmedCount: 1,
    workstreamCount: 1,
    items: [attention.items[0]!.attribution!],
    omitted: 0,
    upkeepCount: 0,
  };
  expect(
    mergeCurrentOwnerAttention(projection, attention).measures.ownerReview.value,
  ).toMatchObject({ count: 1, confirmedCount: 1, workstreamCount: 1, omitted: 0 });
  const resolved = report(projection, { ...workstream, pendingApprovals: [] });
  expect(mergeCurrentOwnerAttention(projection, resolved).measures.ownerReview.value).toMatchObject(
    { count: 0, confirmedCount: 0, workstreamCount: 0, items: [] },
  );
});
