import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { applyInitPlan, createInitPlan } from "@lervo/project";

import {
  createDevelopmentPatternCandidate,
  createDevelopmentPatternPromotionPlan,
  createDevelopmentPatternReview,
  applyDevelopmentPatternPromotion,
  publicDevelopmentPatternPromotionPlan,
  sha256,
  type DevelopmentPatternProposal,
  type PassedWorkflowVerificationEvidence,
  type RepositoryKnowledgeScan,
} from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function verification(suffix: "a" | "b"): PassedWorkflowVerificationEvidence {
  return {
    eventId: `evt_workflow_${suffix.repeat(8)}`,
    eventHash: sha256(`event-${suffix}`),
    runId: `run_workflow_${suffix.repeat(8)}`,
    verificationId: `ver_${suffix.repeat(16)}`,
    suiteHash: sha256(`suite-${suffix}`),
    repositoryRevision: sha256(`revision-${suffix}`),
    resultContentHash: sha256(`result-${suffix}`),
  };
}

function scan(snapshot = "ksnap_current"): RepositoryKnowledgeScan {
  return {
    schemaVersion: 1,
    projectId: "prj_candidate01",
    policyId: "policy_candidate01",
    scannerBuild: "repository-scanner-v1",
    snapshotId: snapshot,
    contentSnapshotId: snapshot,
    coverage: { included: 2, excluded: 0, unsupported: 0, includedBytes: 24, complete: true },
    sources: [],
    units: [
      {
        unitId: "unit_a",
        unitVersionId: "uv_a",
        sourceId: "source_a",
        sourceHash: sha256("source-a"),
        unitHash: sha256("unit-a"),
        unitKind: "file",
        path: "workflows/a.md",
        locator: "file",
        range: { startByte: 0, endByte: 12, startLine: 1, endLine: 1 },
      },
      {
        unitId: "unit_b",
        unitVersionId: "uv_b",
        sourceId: "source_b",
        sourceHash: sha256("source-b"),
        unitHash: sha256("unit-b"),
        unitKind: "file",
        path: "workflows/b.md",
        locator: "file",
        range: { startByte: 0, endByte: 12, startLine: 1, endLine: 1 },
      },
    ],
  };
}

function proposal(evidence: PassedWorkflowVerificationEvidence[]): DevelopmentPatternProposal {
  return {
    schemaVersion: 1,
    title: "Repeat verified release checks",
    summary: "Reuse the independently verified release-check workflow.",
    scope: "release verification",
    occurrences: [
      { path: "workflows/a.md", locator: "file", independentGroup: "release-a" },
      { path: "workflows/b.md", locator: "file", independentGroup: "release-b" },
    ],
    exceptions: ["Do not publish automatically."],
    affectedInvariants: ["Publication authority remains separate."],
    reasonsToChange: ["The workflow is repeated and independently verified."],
    verificationCommands: ["pnpm quality:check"],
    target: {
      kind: "portable_skill",
      path: ".agents/skills/release-check/SKILL.md",
      content:
        "---\nname: release-check\ndescription: Run bounded release checks.\n---\n\n# Release check\n\nRun the reviewed checks without publishing.\n",
    },
    workflowVerification: evidence.map((item, index) => ({
      independentGroup: index === 0 ? "release-a" : "release-b",
      ...item,
    })),
    portableSkillContract: {
      skillId: "release-check",
      capabilityId: "repository/release_check",
      version: "1.0.0",
      supportedRoles: ["developer"],
      providerCompatibility: { mode: "any" },
      minimumRuntimeVersion: "0.11.4",
      platforms: ["darwin", "linux", "win32"],
      requiredTools: ["pnpm"],
      requiredCapabilities: ["filesystem.read", "shell.execute"],
      dependencies: [],
      inputSchemaRef: "lervo-schema://skill/input/v1",
      outputSchemaRef: "lervo-schema://skill/output/v1",
      resources: [
        {
          path: "references/checklist.md",
          content: "# Checklist\n\nRun quality and release completion checks.\n",
          purpose: "Defines the bounded verification checklist.",
          required: true,
        },
      ],
    },
  };
}

describe("portable-skill development-pattern candidates", () => {
  it("binds distinct source and passed-verification hashes into reviewable package bytes", () => {
    const evidence = [verification("a"), verification("b")];
    const result = createDevelopmentPatternCandidate({
      proposal: proposal(evidence),
      scan: scan(),
      passedVerificationEvidence: evidence,
    });

    expect(result.candidate.occurrences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceHash: sha256("source-a"), unitHash: sha256("unit-a") }),
        expect.objectContaining({ sourceHash: sha256("source-b"), unitHash: sha256("unit-b") }),
      ]),
    );
    expect(result.candidate.portableSkillPackage).toMatchObject({
      resources: [expect.objectContaining({ path: "references/checklist.md", required: true })],
    });
    expect(result.candidate.portableSkillPackage?.manifestContent).toContain(
      '"enabledScope": {\n    "kind": "disabled"',
    );
    expect(result.candidate.portableSkillPackage?.capabilityManifestContent).toContain(
      '"capabilityId": "repository/release_check"',
    );
  });

  it("rejects reused verification runs and changed verification hashes", () => {
    const evidence = [verification("a"), verification("b")];
    const reused = proposal(evidence);
    reused.workflowVerification![1] = {
      ...reused.workflowVerification![1]!,
      eventId: evidence[0]!.eventId,
      runId: evidence[0]!.runId,
    };
    expect(() =>
      createDevelopmentPatternCandidate({
        proposal: reused,
        scan: scan(),
        passedVerificationEvidence: evidence,
      }),
    ).toThrow(/distinct passed verification/u);

    const changed = proposal(evidence);
    changed.workflowVerification![0]!.resultContentHash = sha256("changed");
    expect(() =>
      createDevelopmentPatternCandidate({
        proposal: changed,
        scan: scan(),
        passedVerificationEvidence: evidence,
      }),
    ).toThrow(/missing, failed, or changed/u);

    const traversingResource = proposal(evidence);
    traversingResource.portableSkillContract!.resources[0]!.path =
      "references/checks/../../SKILL.md";
    expect(() =>
      createDevelopmentPatternCandidate({
        proposal: traversingResource,
        scan: scan(),
        passedVerificationEvidence: evidence,
      }),
    ).toThrow(/resource is unsafe or unbounded/u);
  });

  it("plans the exact skill instructions, resources, and disabled contract as one rollback unit", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-portable-skill-pattern-"));
    roots.push(root);
    const evidence = [verification("a"), verification("b")];
    const candidate = createDevelopmentPatternCandidate({
      proposal: proposal(evidence),
      scan: scan(),
      passedVerificationEvidence: evidence,
    });
    const review = createDevelopmentPatternReview({
      patternId: candidate.candidate.patternId,
      candidateContentHash: candidate.contentHash,
      decision: "accept",
      reviewer: "repository-maintainer",
      reviewedAt: "2026-09-05T01:00:00.000Z",
    });
    const plan = await createDevelopmentPatternPromotionPlan({
      repositoryRoot: root,
      projectId: "prj_candidate01",
      candidate: candidate.candidate,
      candidateContentHash: candidate.contentHash,
      review: review.review,
      reviewContentHash: review.contentHash,
      currentScan: scan("ksnap_changed"),
      passedVerificationEvidence: evidence,
    });

    expect(plan).toMatchObject({
      status: "blocked",
      blockers: ["source_snapshot_changed"],
    });
    expect(plan.operations.map((item) => item.path)).toEqual([
      ".agents/skills/release-check/SKILL.md",
      ".agents/skills/release-check/references/checklist.md",
      ".agents/skills/release-check/lervo-skill.json",
      ".agents/skills/release-check/lervo-capability.json",
    ]);
    expect(JSON.stringify(publicDevelopmentPatternPromotionPlan(plan))).not.toContain(
      "Run the reviewed checks",
    );
  });

  it("rolls back all package files on finalization failure and preserves conflicting bytes", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-portable-skill-rollback-"));
    roots.push(root);
    await applyInitPlan(await createInitPlan({ root, projectId: "prj_candidate01" }));
    const evidence = [verification("a"), verification("b")];
    const candidate = createDevelopmentPatternCandidate({
      proposal: proposal(evidence),
      scan: scan(),
      passedVerificationEvidence: evidence,
    });
    const review = createDevelopmentPatternReview({
      patternId: candidate.candidate.patternId,
      candidateContentHash: candidate.contentHash,
      decision: "accept",
      reviewer: "repository-maintainer",
      reviewedAt: "2026-09-05T01:00:00.000Z",
    });
    const plan = await createDevelopmentPatternPromotionPlan({
      repositoryRoot: root,
      projectId: "prj_candidate01",
      candidate: candidate.candidate,
      candidateContentHash: candidate.contentHash,
      review: review.review,
      reviewContentHash: review.contentHash,
      currentScan: scan(),
      passedVerificationEvidence: evidence,
    });
    expect(plan.status).toBe("ready");

    await expect(
      applyDevelopmentPatternPromotion({
        plan,
        approval: plan.planId,
        receipt: { status: "not-recorded" },
        recordApplied: () => {
          throw new Error("simulated event failure");
        },
      }),
    ).rejects.toThrow(/rolled back/u);
    for (const operation of plan.operations)
      await expect(readFile(resolve(root, operation.path))).rejects.toMatchObject({
        code: "ENOENT",
      });

    const target = resolve(root, candidate.candidate.target.path);
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, "# Maintainer-owned skill\n");
    const conflict = await createDevelopmentPatternPromotionPlan({
      repositoryRoot: root,
      projectId: "prj_candidate01",
      candidate: candidate.candidate,
      candidateContentHash: candidate.contentHash,
      review: review.review,
      reviewContentHash: review.contentHash,
      currentScan: scan(),
      passedVerificationEvidence: evidence,
    });
    expect(conflict).toMatchObject({ status: "blocked", blockers: ["target_conflict"] });
    await expect(
      applyDevelopmentPatternPromotion({
        plan: conflict,
        approval: conflict.planId,
        receipt: {},
        recordApplied: () => undefined,
      }),
    ).rejects.toThrow(/promotion is blocked/u);
    expect(await readFile(target, "utf8")).toBe("# Maintainer-owned skill\n");
  });
});
