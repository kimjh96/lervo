import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import {
  createSearchRetrievalPlan,
  createSearchRetrievalPlanActivationBundle,
  createSearchRetrievalPlanPolicy,
  createSearchRetrievalPlanReview,
} from "@lervo/search";
import { afterEach, describe, expect, it } from "vitest";

import {
  activateLocalSearchRetrievalPlan,
  inspectOperationalSearchRetrievalPlan,
  recordSearchRetrievalPlanActivationBundle,
  rollbackLocalSearchRetrievalPlan,
} from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function bundle(projectId: string, evidenceHash: string) {
  const plan = createSearchRetrievalPlan({
    projection: {
      required: true,
      populations: [
        {
          populationId: "provider.codex",
          projector: {
            id: "provider_query_projection.codex",
            version: 1,
            buildId: `sqbuild_${"1".repeat(24)}`,
          },
        },
        {
          populationId: "provider.claude",
          projector: {
            id: "provider_query_projection.claude",
            version: 1,
            buildId: `sqbuild_${"2".repeat(24)}`,
          },
        },
      ],
      maximumQueries: 8,
      maximumQueryCharacters: 500,
    },
    retrieval: {
      stageId: "primary_retrieval",
      candidateId: "lexical-v2",
      engine: { id: "lexical", version: 2 },
      adapterBuildId: `sebuild_${"3".repeat(24)}`,
      perQueryLimit: 50,
    },
    fusion: { algorithm: "query_coverage_interleave", version: 1 },
    finalLimit: 10,
    failurePolicy: "fail_closed",
    privacy: {
      requestText: "excluded",
      contextText: "excluded",
      projectedQueryText: "excluded",
      credentials: "excluded",
    },
  });
  const review = createSearchRetrievalPlanReview({
    planId: plan.planId,
    reviewerId: "owner",
    reviewedAt: "2026-08-31T07:00:00.000Z",
    decision: "activate",
    corpus: {
      sourceSnapshotId: `ksnap_${"4".repeat(24)}`,
      digest: `sha256:${"5".repeat(64)}`,
      documentCount: 2,
      byteCount: 200,
    },
    suite: {
      suiteId: "fixture.v1",
      bindingHash: `sha256:${"6".repeat(64)}`,
      cases: 2,
      repetitions: 5,
    },
    populations: ["codex", "claude"].map((provider, index) => ({
      populationId: `provider.${provider}`,
      reportId: `report_${provider}_fixture`,
      reportHash: `sha256:${String(index + 7).repeat(64)}`,
      passedObservations: 10,
      totalObservations: 10,
      usageComplete: true,
      projectionFailures: 0,
      durationWithinLimit: true,
    })),
    engineEvidence: {
      evidencePath: "docs/evidence.md",
      evidenceHash,
      qualityGatePassed: true,
      efficiencyGatePassed: true,
    },
  });
  const policy = createSearchRetrievalPlanPolicy({
    projectId,
    allowedPlanIds: [plan.planId],
    reviewerIds: ["owner"],
    operatorIds: ["owner"],
    authorId: "owner",
    createdAt: "2026-08-31T07:01:00.000Z",
    minimumPopulations: 2,
    requirePerfectObservationPass: true,
    requireCompleteUsage: true,
    requireZeroProjectionFailures: true,
    requireDurationWithinLimit: true,
  });
  return createSearchRetrievalPlanActivationBundle({ plan, review, policy });
}

describe("local search retrieval-plan activation", () => {
  it("uses a product-qualified plan on the current corpus without repository activation", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-product-default-plan-"));
    roots.push(root);
    const projectId = "prj_product_default_fixture";
    await applyInitPlan(await createInitPlan({ root, projectId }));
    const candidate = bundle(projectId, `sha256:${"9".repeat(64)}`);

    await expect(
      inspectOperationalSearchRetrievalPlan({
        repositoryRoot: root,
        projectId,
        productDefault: {
          qualificationId: `spqual_${"a".repeat(24)}`,
          plan: candidate.plan,
        },
      }),
    ).resolves.toMatchObject({
      selection: {
        mode: "product_default",
        qualificationId: `spqual_${"a".repeat(24)}`,
        planId: candidate.plan.planId,
      },
      transitions: 0,
      resolverState: "ready",
      plan: candidate.plan,
      productQualificationId: `spqual_${"a".repeat(24)}`,
    });
  });

  it("resolves an immutable bundle and returns to the local baseline by explicit rollback", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-retrieval-plan-"));
    roots.push(root);
    const projectId = "prj_retrieval_fixture";
    await applyInitPlan(await createInitPlan({ root, projectId }));
    await mkdir(resolve(root, "docs"));
    const evidence = "# Reviewed evidence\n";
    await writeFile(resolve(root, "docs/evidence.md"), evidence);
    const evidenceHash = `sha256:${createHash("sha256").update(evidence).digest("hex")}`;
    const candidate = bundle(projectId, evidenceHash);
    await recordSearchRetrievalPlanActivationBundle(root, candidate);
    const activation = await activateLocalSearchRetrievalPlan({
      repositoryRoot: root,
      projectId,
      bundleId: candidate.bundleId,
      operatorId: "owner",
      decidedAt: new Date("2026-08-31T07:02:00.000Z"),
    });
    await expect(
      inspectOperationalSearchRetrievalPlan({ repositoryRoot: root, projectId }),
    ).resolves.toMatchObject({
      selection: { mode: "candidate", planId: candidate.plan.planId },
      selectionTransitionId: activation.activationId,
      resolverState: "ready",
    });
    await rollbackLocalSearchRetrievalPlan({
      repositoryRoot: root,
      projectId,
      operatorId: "owner",
      decidedAt: new Date("2026-08-31T07:03:00.000Z"),
    });
    await expect(
      inspectOperationalSearchRetrievalPlan({ repositoryRoot: root, projectId }),
    ).resolves.toMatchObject({
      selection: { mode: "baseline" },
      transitions: 2,
      resolverState: "ready",
    });
  });
});
