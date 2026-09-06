import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { renderRepositoryRoleSource, resolveRoleContract, roleProfileHash } from "@lervo/roles";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyDevelopmentPatternPromotion,
  applyDevelopmentPatternRollback,
  createDevelopmentPatternCandidate,
  createDevelopmentPatternPromotionPlan,
  createDevelopmentPatternReview,
  createDevelopmentPatternRollbackPlan,
  sha256,
  type AgentProfileEvidenceReference,
  type DevelopmentPatternProposal,
  type PassedWorkflowVerificationEvidence,
  type RepositoryKnowledgeScan,
  type RoleProfileActivationEvidence,
} from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function scan(): RepositoryKnowledgeScan {
  return {
    schemaVersion: 1,
    projectId: "prj_profile_candidate",
    policyId: "policy_profile_candidate",
    scannerBuild: "repository-scanner-v1",
    snapshotId: "ksnap_profile_candidate",
    contentSnapshotId: "ksnap_profile_candidate",
    coverage: { included: 2, excluded: 0, unsupported: 0, includedBytes: 16, complete: true },
    sources: [],
    units: ["a", "b"].map((suffix, index) => ({
      unitId: `unit_${suffix}`,
      unitVersionId: `uv_${suffix}`,
      sourceId: `source_${suffix}`,
      sourceHash: sha256(`source-${suffix}`),
      unitHash: sha256(`unit-${suffix}`),
      unitKind: "verification" as const,
      path: `evidence/${suffix}.json`,
      locator: "event",
      range: { startByte: index * 8, endByte: index * 8 + 8, startLine: 1, endLine: 1 },
    })),
  };
}

function verification(suffix: "a" | "b"): PassedWorkflowVerificationEvidence {
  return {
    eventId: `evt_profile_verification_${suffix.repeat(8)}`,
    eventHash: sha256(`verification-event-${suffix}`),
    runId: `run_profile_${suffix.repeat(8)}`,
    verificationId: `ver_${suffix.repeat(16)}`,
    suiteHash: sha256(`suite-${suffix}`),
    repositoryRevision: sha256(`revision-${suffix}`),
    resultContentHash: sha256(`result-${suffix}`),
  };
}

function activation(
  suffix: "a" | "b",
  source: Awaited<ReturnType<typeof resolveRoleContract>>,
): RoleProfileActivationEvidence {
  return {
    eventId: `evt_profile_activation_${suffix.repeat(8)}`,
    eventHash: sha256(`activation-event-${suffix}`),
    runId: `run_profile_${suffix.repeat(8)}`,
    provider: suffix === "a" ? "codex" : "claude",
    roleId: source.roleId,
    roleVersion: source.version,
    roleContractHash: source.contractHash,
    roleProfileHash: roleProfileHash(source.definition.profile),
    runtimeProfileHash: sha256(`runtime-profile-${suffix}`),
  };
}

function evidence(source: Awaited<ReturnType<typeof resolveRoleContract>>): {
  references: AgentProfileEvidenceReference[];
  verifications: PassedWorkflowVerificationEvidence[];
  activations: RoleProfileActivationEvidence[];
} {
  const verifications = [verification("a"), verification("b")];
  const activations = [activation("a", source), activation("b", source)];
  return {
    references: ["a", "b"].map((suffix, index) => ({
      independentGroup: `profile-${suffix}`,
      activation: activations[index]!,
      verification: {
        independentGroup: `profile-${suffix}`,
        ...verifications[index]!,
      },
    })),
    verifications,
    activations,
  };
}

function proposal(
  references: AgentProfileEvidenceReference[],
  expectedCurrentHash: string | null = null,
): DevelopmentPatternProposal {
  const content = renderRepositoryRoleSource({
    schemaVersion: 1,
    kind: "lervo_repository_role",
    roleId: "evidence-developer",
    version: expectedCurrentHash === null ? "1.0.0" : "1.1.0",
    extends: [{ roleId: "developer", version: "1.0.0" }],
    profile: {
      name: "Evidence Developer",
      description: "Uses the reviewed evidence-bound developer role contract.",
      requestTypes: ["implementation.evidence"],
    },
    checks: [],
  });
  return {
    schemaVersion: 1,
    title: "Evidence-bound developer profile",
    summary: "Specialize the developer role from independently verified managed executions.",
    scope: "repository role profile",
    occurrences: ["a", "b"].map((suffix) => ({
      path: `evidence/${suffix}.json`,
      locator: "event",
      independentGroup: `profile-${suffix}`,
    })),
    exceptions: ["Do not alter built-in roles."],
    affectedInvariants: ["Managed roles remain exact-version and hash bound."],
    reasonsToChange: ["Two independently verified runs support the specialization."],
    verificationCommands: ["pnpm quality:check"],
    target: {
      kind: "agent_profile",
      path: ".lervo/roles/evidence-developer.json",
      content,
      expectedCurrentHash,
    },
    agentProfileEvidence: references,
  };
}

describe("agent-profile development patterns", () => {
  it("requires exact activated and passed evidence for one source role", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-agent-profile-candidate-"));
    roots.push(root);
    await applyInitPlan(await createInitPlan({ root, projectId: "prj_profile_candidate" }));
    const source = await resolveRoleContract(root, "developer");
    const observed = evidence(source);
    const result = createDevelopmentPatternCandidate({
      proposal: proposal(observed.references),
      scan: scan(),
      passedVerificationEvidence: observed.verifications,
      roleProfileActivationEvidence: observed.activations,
    });
    expect(result.candidate.target).toMatchObject({
      kind: "agent_profile",
      expectedCurrentHash: null,
    });

    const changed = structuredClone(observed.references);
    changed[0]!.activation.roleContractHash = sha256("changed");
    expect(() =>
      createDevelopmentPatternCandidate({
        proposal: proposal(changed),
        scan: scan(),
        passedVerificationEvidence: observed.verifications,
        roleProfileActivationEvidence: observed.activations,
      }),
    ).toThrow(/missing or changed/u);
  });

  it("promotes a reviewed specialization and rolls it back as exact user-owned bytes", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-agent-profile-promotion-"));
    roots.push(root);
    await applyInitPlan(await createInitPlan({ root, projectId: "prj_profile_candidate" }));
    const source = await resolveRoleContract(root, "developer");
    const observed = evidence(source);
    const candidate = createDevelopmentPatternCandidate({
      proposal: proposal(observed.references),
      scan: scan(),
      passedVerificationEvidence: observed.verifications,
      roleProfileActivationEvidence: observed.activations,
    });
    const review = createDevelopmentPatternReview({
      patternId: candidate.candidate.patternId,
      candidateContentHash: candidate.contentHash,
      decision: "accept",
      reviewer: "repository-maintainer",
      reviewedAt: "2026-09-06T00:00:00.000Z",
    });
    const plan = await createDevelopmentPatternPromotionPlan({
      repositoryRoot: root,
      projectId: "prj_profile_candidate",
      candidate: candidate.candidate,
      candidateContentHash: candidate.contentHash,
      review: review.review,
      reviewContentHash: review.contentHash,
      currentScan: scan(),
      passedVerificationEvidence: observed.verifications,
      roleProfileActivationEvidence: observed.activations,
    });
    expect(plan).toMatchObject({
      status: "ready",
      rollbackTarget: { disposition: "delete_created", previousContentHash: null },
      operations: [expect.objectContaining({ action: "create", ownership: "user" })],
    });
    await applyDevelopmentPatternPromotion({
      plan,
      approval: plan.planId,
      receipt: { applied: true },
      recordApplied: async () => {
        expect((await resolveRoleContract(root, "evidence-developer")).version).toBe("1.0.0");
      },
    });
    expect(await readFile(resolve(root, ".lervo/roles/evidence-developer.json"), "utf8")).toBe(
      candidate.candidate.target.content,
    );

    const rollback = await createDevelopmentPatternRollbackPlan({
      repositoryRoot: root,
      projectId: "prj_profile_candidate",
      patternState: "promoted",
      candidate: candidate.candidate,
      candidateContentHash: candidate.contentHash,
      previousTargetContentHash: null,
      previousTargetContent: null,
    });
    expect(rollback.status).toBe("ready");
    await applyDevelopmentPatternRollback({
      plan: rollback,
      approval: rollback.planId,
      receipt: { rolledBack: true },
      recordApplied: () => undefined,
    });
    await expect(resolveRoleContract(root, "evidence-developer")).rejects.toMatchObject({
      code: "role_not_found",
    });
  });

  it("replaces an activated repository profile and restores its exact predecessor", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-agent-profile-replacement-"));
    roots.push(root);
    await applyInitPlan(await createInitPlan({ root, projectId: "prj_profile_candidate" }));
    const developer = await resolveRoleContract(root, "developer");
    const initialEvidence = evidence(developer);
    const initial = createDevelopmentPatternCandidate({
      proposal: proposal(initialEvidence.references),
      scan: scan(),
      passedVerificationEvidence: initialEvidence.verifications,
      roleProfileActivationEvidence: initialEvidence.activations,
    });
    const initialReview = createDevelopmentPatternReview({
      patternId: initial.candidate.patternId,
      candidateContentHash: initial.contentHash,
      decision: "accept",
      reviewer: "repository-maintainer",
      reviewedAt: "2026-09-06T00:00:00.000Z",
    });
    const initialPlan = await createDevelopmentPatternPromotionPlan({
      repositoryRoot: root,
      projectId: "prj_profile_candidate",
      candidate: initial.candidate,
      candidateContentHash: initial.contentHash,
      review: initialReview.review,
      reviewContentHash: initialReview.contentHash,
      currentScan: scan(),
      passedVerificationEvidence: initialEvidence.verifications,
      roleProfileActivationEvidence: initialEvidence.activations,
    });
    await applyDevelopmentPatternPromotion({
      plan: initialPlan,
      approval: initialPlan.planId,
      receipt: { applied: true },
      recordApplied: () => undefined,
    });
    const initialContent = initial.candidate.target.content;
    const initialHash = sha256(initialContent);
    const currentRole = await resolveRoleContract(root, "evidence-developer");
    const replacementEvidence = evidence(currentRole);
    const replacement = createDevelopmentPatternCandidate({
      proposal: proposal(replacementEvidence.references, initialHash),
      scan: scan(),
      passedVerificationEvidence: replacementEvidence.verifications,
      roleProfileActivationEvidence: replacementEvidence.activations,
    });
    const replacementReview = createDevelopmentPatternReview({
      patternId: replacement.candidate.patternId,
      candidateContentHash: replacement.contentHash,
      decision: "accept",
      reviewer: "repository-maintainer",
      reviewedAt: "2026-09-06T01:00:00.000Z",
    });
    const replacementPlan = await createDevelopmentPatternPromotionPlan({
      repositoryRoot: root,
      projectId: "prj_profile_candidate",
      candidate: replacement.candidate,
      candidateContentHash: replacement.contentHash,
      review: replacementReview.review,
      reviewContentHash: replacementReview.contentHash,
      currentScan: scan(),
      passedVerificationEvidence: replacementEvidence.verifications,
      roleProfileActivationEvidence: replacementEvidence.activations,
    });
    expect(replacementPlan).toMatchObject({
      status: "ready",
      rollbackTarget: {
        disposition: "restore_previous",
        previousContentHash: initialHash,
      },
      operations: [expect.objectContaining({ action: "update", ownership: "user" })],
    });
    await applyDevelopmentPatternPromotion({
      plan: replacementPlan,
      approval: replacementPlan.planId,
      receipt: { applied: true },
      recordApplied: async () => {
        expect((await resolveRoleContract(root, "evidence-developer")).version).toBe("1.1.0");
      },
    });
    const rollback = await createDevelopmentPatternRollbackPlan({
      repositoryRoot: root,
      projectId: "prj_profile_candidate",
      patternState: "promoted",
      candidate: replacement.candidate,
      candidateContentHash: replacement.contentHash,
      previousTargetContentHash: initialHash,
      previousTargetContent: initialContent,
    });
    await applyDevelopmentPatternRollback({
      plan: rollback,
      approval: rollback.planId,
      receipt: { rolledBack: true },
      recordApplied: async () => {
        expect((await resolveRoleContract(root, "evidence-developer")).version).toBe("1.0.0");
      },
    });
    expect(await readFile(resolve(root, ".lervo/roles/evidence-developer.json"), "utf8")).toBe(
      initialContent,
    );
  });
});
