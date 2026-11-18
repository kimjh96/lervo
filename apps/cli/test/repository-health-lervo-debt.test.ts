import { assessWorkstreamFreshness } from "@lervo/repository-knowledge";
import type { WorkstreamSnapshot } from "@lervo/schemas";
import { expect, it } from "vitest";
import { createOperatingAttentionReport } from "../src/operating-attention-projection.js";
import { formatCompactTerminalPreamble } from "../src/terminal-compact-format.js";
import {
  mergeCurrentLervoDebt,
  projectHealthLervoDebt,
} from "../src/repository-health-lervo-debt.js";
import { formatRepositoryHealth } from "../src/repository-health-format.js";
import { unknownRepositoryHealth } from "../src/repository-health-reader.js";
import { healthNow, healthRevision, healthyProjection } from "./repository-health-fixture.js";

const workstream: WorkstreamSnapshot = {
  schemaVersion: 1,
  workstreamId: "wks_0123456789abcdef01234567",
  revision: 1,
  status: "active",
  title: "Recorded approval",
  objective: "Settle a recorded approval as Lervo debt",
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
  "reports a recorded approval as Lervo debt, never owner work, when the cache is %s",
  (reason) => {
    const attention = report(unknownRepositoryHealth(healthRevision, healthNow, reason));
    expect(attention.items[0]).toMatchObject({
      kind: "workstream_approval",
      state: "lervo_debt",
      requiresUserAction: false,
      blocking: false,
      attribution: { actor: "working agent", requiresUserAction: false, consequence: null },
    });
    const text = formatCompactTerminalPreamble({
      publicationLanguage: "en",
      attention,
      declarationInstruction: "Declare",
      backgroundKnowledgeActive: false,
      workstreamPresent: true,
      staleWorkstreamEntryCount: 0,
    });
    expect(text).toContain("Lervo debt (no owner action): 1 held");
    expect(text).toContain("recorded_workstream_approval");
    expect(text).not.toContain("owner authority");
  },
);

it("replaces cached workstream debt with the current approvals", () => {
  const projection = healthyProjection();
  const attention = report();
  expect(mergeCurrentLervoDebt(projection, attention).measures.lervoDebt.value).toMatchObject({
    count: 1,
    topReason: "recorded_workstream_approval",
    sources: [{ source: "workstream_approval", count: 1 }],
  });
  const merged = mergeCurrentLervoDebt(projection, attention);
  const resolved = report(merged, { ...workstream, pendingApprovals: [] });
  expect(mergeCurrentLervoDebt(merged, resolved).measures.lervoDebt.value).toMatchObject({
    count: 0,
    sources: [],
  });
});

it("collects every debt source into one line with count, oldest age, and top reason", () => {
  const attention = createOperatingAttentionReport({
    projectId: "prj_health",
    workstream: null,
    workstreamFreshness: null,
    canonicalization: { coverage: "complete", candidates: [] },
    knowledgeLifecycle: { coverage: "complete", issues: [] },
    heldEffects: [
      {
        effect: "upgrade_knowledge",
        subject: "kplan_one",
        reasonCode: "cross_check_disagreement_repeated",
        since: "2026-10-30T02:00:00.000Z",
        lastAttemptAt: healthNow.toISOString(),
        attempts: 2,
      },
      {
        effect: "capability_install",
        subject: "cap@1.0.0",
        reasonCode: "stronger_check_disagreement",
        since: "2026-10-31T02:00:00.000Z",
        lastAttemptAt: healthNow.toISOString(),
        attempts: 1,
      },
    ],
    knowledgeConvergence: {
      owner: {
        verdict: {
          role: "unverifiable",
          reason: "convergence_owner_unverifiable",
          failureCode: "hub_unreachable",
          httpStatus: null,
          observedAt: "2026-10-31T12:00:00.000Z",
        },
      } as never,
      publication: null,
    },
    observedAt: healthNow,
  });
  const projection = healthyProjection();
  projection.measures.lervoDebt = projectHealthLervoDebt({
    now: healthNow,
    attention,
    maintenance: {
      observedAt: healthNow.toISOString(),
      status: { state: "attention", reason: "knowledge_sources_parked" },
    },
    continuity: null,
    nodeHealth: {
      supervision: {
        status: "lervo_debt",
        reasonCode: "principal_scope_exceeded",
        since: "2026-10-29T02:00:00.000Z",
      },
    },
  } as never);
  expect(projection.measures.lervoDebt.value).toMatchObject({
    count: 5,
    oldestSince: "2026-10-29T02:00:00.000Z",
    credentials: [],
  });
  expect(projection.measures.lervoDebt.value!.sources.map((item) => item.source)).toEqual([
    "node_supervision",
    "held_effect",
    "knowledge_convergence_owner",
    "knowledge_convergence",
  ]);
  const lines = formatRepositoryHealth(projection, healthNow).split("\n");
  expect(lines.filter((line) => line.includes("Lervo debt"))).toHaveLength(1);
  expect(lines[0]).toMatch(
    /^Lervo health: Lervo debt \(no owner action\): 5 held, oldest 2d, top reason \S+ \(node_supervision 1, held_effect 2, knowledge_convergence_owner 1\); Lervo retries each; details: lervo application attention --json\./u,
  );
});

it("reports a missing credential as a notice beside the debt, never as an approval", () => {
  const attention = createOperatingAttentionReport({
    projectId: "prj_health",
    workstream: null,
    workstreamFreshness: null,
    canonicalization: { coverage: "complete", candidates: [] },
    knowledgeLifecycle: { coverage: "complete", issues: [] },
    knowledgeConvergence: {
      owner: {
        verdict: {
          role: "unverifiable",
          reason: "convergence_owner_unverifiable",
          failureCode: "hub_unauthorized",
          httpStatus: 401,
          observedAt: healthNow.toISOString(),
        },
      } as never,
      publication: null,
    },
    observedAt: healthNow,
  });
  const projection = healthyProjection();
  projection.measures.lervoDebt = projectHealthLervoDebt({
    now: healthNow,
    attention,
    maintenance: null,
    continuity: null,
  } as never);
  expect(projection.measures.lervoDebt.value).toMatchObject({ count: 0 });
  expect(projection.measures.lervoDebt.value!.credentials).toHaveLength(1);
  expect(formatRepositoryHealth(projection, healthNow)).toContain(
    "notice, 1 credential missing: Replace the rejected Hub token",
  );
});
