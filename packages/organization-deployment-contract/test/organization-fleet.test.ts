import { generateKeyPairSync, sign, verify } from "node:crypto";

import { calculateNodeFleetServiceInstanceId } from "@lervo/repository-registry";
import { describe, expect, it } from "vitest";

import {
  applyOrganizationNodeRolloutExecution,
  applyAuthenticatedOrganizationNodeRolloutDelivery,
  assertOrganizationFleetRolloutExecutionAuthority,
  createOrganizationNodeRolloutExecutionPlan,
  createOrganizationNodeRolloutDelivery,
  createSignedOrganizationNodeRolloutDelivery,
  createSignedOrganizationDeploymentPolicy,
  createOrganizationDeploymentPolicy,
  createOrganizationFleetRolloutApproval,
  createOrganizationFleetRolloutPlan,
  createOrganizationFleetWaveObservation,
  createOrganizationNodeEnrollment,
  createOrganizationRuntimeCredentialGrant,
  createOrganizationRuntimeCredentialRevocation,
  deliverOrganizationRuntimeCredential,
  evaluateOrganizationFleetWave,
  organizationDeploymentPolicySigningBytes,
  organizationNodeRolloutDeliverySigningBytes,
} from "../src/index.js";

const project = {
  projectId: "prj_organization01",
  projectIdentityHash: `sha256:${"a".repeat(64)}`,
};
const initialArtifactHash = `sha256:${"b".repeat(64)}`;
const targetArtifactHash = `sha256:${"c".repeat(64)}`;

function policy() {
  return createOrganizationDeploymentPolicy({
    organizationId: "org_example01",
    sequence: 1,
    previousPolicyId: null,
    issuedAt: "2026-08-27T00:00:00.000Z",
    expiresAt: "2026-08-28T00:00:00.000Z",
    tenancy: { mode: "strict_project", projects: [project] },
    authorities: [
      {
        principalId: "operator:approval",
        permissions: ["rollout.approve"],
        projectIds: [project.projectId],
      },
      {
        principalId: "operator:delivery",
        permissions: ["credential.deliver"],
        projectIds: [project.projectId],
      },
      {
        principalId: "operator:deployment",
        permissions: ["deployment.plan", "node.enroll"],
        projectIds: [project.projectId],
      },
      {
        principalId: "operator:execution",
        permissions: ["rollout.execute", "rollout.rollback"],
        projectIds: [project.projectId],
      },
      {
        principalId: "operator:security",
        permissions: ["credential.issue", "credential.revoke", "credential.rotate"],
        projectIds: [project.projectId],
      },
    ],
    credentialPolicy: {
      deliveryMode: "runtime_only",
      separationOfDuties: "issuer_and_deliverer_distinct",
      maximumTtlSeconds: 3_600,
      maximumRotationOverlapSeconds: 300,
      allowedPermissions: ["sync.write", "workstream.read", "workstream.write"],
    },
  });
}

async function enrollment(index: number) {
  const nodeId = `node_organization0${index}`;
  const destinationId = `hub:organization:${index}`;
  const sourcePolicy = policy();
  const grant = createOrganizationRuntimeCredentialGrant({
    policy: sourcePolicy,
    target: project,
    nodeId,
    destinationId,
    subjectPrincipalId: `node:organization0${index}`,
    permissions: ["sync.write", "workstream.read", "workstream.write"],
    issuedBy: "operator:security",
    issuedAt: "2026-08-27T00:01:00.000Z",
    notBefore: "2026-08-27T00:01:00.000Z",
    expiresAt: "2026-08-27T01:01:00.000Z",
  });
  const receipt = await deliverOrganizationRuntimeCredential({
    policy: sourcePolicy,
    grant,
    deliveredBy: "operator:delivery",
    deliveredAt: "2026-08-27T00:02:00.000Z",
    source: {
      load: async () =>
        new TextEncoder().encode(`runtime-token-${index}-abcdefghijklmnopqrstuvwxyz-0123456789`),
    },
    consumer: { activate: async () => undefined },
  });
  return {
    sourcePolicy,
    grant,
    receipt,
    enrollment: createOrganizationNodeEnrollment({
      policy: sourcePolicy,
      grant,
      deliveryReceipt: receipt,
      serviceInstanceId: calculateNodeFleetServiceInstanceId({
        projectId: project.projectId,
        repositoryIdentityHash: project.projectIdentityHash,
        nodeId,
      }),
      runtimeVersion: "0.3.1",
      runtimeArtifactHash: initialArtifactHash,
      localPlanId: `nfp_${String(index).repeat(24)}`,
      localApplyReceiptHash: `sha256:${String(index).repeat(64)}`,
      readiness: {
        status: "ready",
        consecutiveObservations: 3,
        sync: "ready",
        workstreamReplication: "ready",
        workspaceCoordination: "disabled",
        remoteControl: "ready",
      },
      enrolledBy: "operator:deployment",
      enrolledAt: "2026-08-27T00:03:00.000Z",
    }),
  };
}

function readyNode(
  source: Awaited<ReturnType<typeof enrollment>>["enrollment"],
  overrides: Partial<{
    runtimeVersion: string;
    runtimeArtifactHash: string;
    status: "ready" | "pending" | "degraded" | "unavailable" | "stale";
    consecutiveObservations: number;
  }> = {},
) {
  return {
    enrollmentId: source.enrollmentId,
    nodeId: source.nodeId,
    runtimeVersion: overrides.runtimeVersion ?? "0.4.0",
    runtimeArtifactHash: overrides.runtimeArtifactHash ?? targetArtifactHash,
    readiness: {
      status: overrides.status ?? ("ready" as const),
      consecutiveObservations: overrides.consecutiveObservations ?? 3,
      sync: "ready" as const,
      workstreamReplication: "ready" as const,
      workspaceCoordination: "disabled" as const,
      remoteControl: "ready" as const,
    },
  };
}

describe("organization Node enrollment", () => {
  it("binds active delivered credentials to exact local readiness without secrets", async () => {
    const fixture = await enrollment(1);

    expect(fixture.enrollment).toMatchObject({
      enrollmentId: expect.stringMatching(/^one_[a-f0-9]{64}$/u),
      credentialId: fixture.grant.credentialId,
      credentialDeliveryId: fixture.receipt.deliveryId,
      readiness: { status: "ready", consecutiveObservations: 3 },
      secretMaterial: "excluded",
    });
    expect(JSON.stringify(fixture.enrollment)).not.toContain("runtime-token");
  });

  it("rejects incomplete readiness and effective credential revocation", async () => {
    const fixture = await enrollment(2);
    expect(() =>
      createOrganizationNodeEnrollment({
        policy: fixture.sourcePolicy,
        grant: fixture.grant,
        deliveryReceipt: fixture.receipt,
        serviceInstanceId: fixture.enrollment.serviceInstanceId,
        runtimeVersion: "0.3.1",
        runtimeArtifactHash: initialArtifactHash,
        localPlanId: `nfp_${"2".repeat(24)}`,
        localApplyReceiptHash: `sha256:${"2".repeat(64)}`,
        readiness: { ...fixture.enrollment.readiness, status: "degraded" },
        enrolledBy: "operator:deployment",
        enrolledAt: "2026-08-27T00:03:00.000Z",
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid_node_enrollment" }));

    const revocation = createOrganizationRuntimeCredentialRevocation({
      policy: fixture.sourcePolicy,
      grant: fixture.grant,
      revokedBy: "operator:security",
      revokedAt: "2026-08-27T00:02:30.000Z",
      reason: "compromised",
    });
    expect(() =>
      createOrganizationNodeEnrollment({
        policy: fixture.sourcePolicy,
        grant: fixture.grant,
        deliveryReceipt: fixture.receipt,
        revocations: [revocation],
        serviceInstanceId: fixture.enrollment.serviceInstanceId,
        runtimeVersion: "0.3.1",
        runtimeArtifactHash: initialArtifactHash,
        localPlanId: `nfp_${"2".repeat(24)}`,
        localApplyReceiptHash: `sha256:${"2".repeat(64)}`,
        readiness: fixture.enrollment.readiness,
        enrolledBy: "operator:deployment",
        enrolledAt: "2026-08-27T00:03:00.000Z",
      }),
    ).toThrowError(expect.objectContaining({ code: "credential_revoked" }));
  });
});

describe("organization fleet gradual rollout", () => {
  it("requires a one-Node canary, bounded wave growth, and exact enrollment coverage", async () => {
    const fixtures = await Promise.all([
      enrollment(1),
      enrollment(2),
      enrollment(3),
      enrollment(4),
    ]);
    const enrollments = fixtures.map((fixture) => fixture.enrollment);
    const plan = createOrganizationFleetRolloutPlan({
      policy: policy(),
      enrollments,
      targetRuntimeVersion: "0.4.0",
      targetArtifactHash,
      waves: [
        [enrollments[0]!.enrollmentId],
        [enrollments[1]!.enrollmentId, enrollments[2]!.enrollmentId],
        [enrollments[3]!.enrollmentId],
      ],
      plannedBy: "operator:deployment",
      plannedAt: "2026-08-27T00:04:00.000Z",
    });
    expect(plan).toMatchObject({
      rolloutPlanId: expect.stringMatching(/^orp_[a-f0-9]{64}$/u),
      healthGate: {
        minimumConsecutiveReadyObservations: 3,
        maximumUnavailableNodes: 0,
        allowOfflineReady: false,
      },
      failurePolicy: "hold_for_explicit_rollback",
      effect: { deployment: "not_executed", approval: "not_granted" },
    });
    expect(() =>
      createOrganizationFleetRolloutPlan({
        policy: policy(),
        enrollments,
        targetRuntimeVersion: "0.4.0",
        targetArtifactHash,
        waves: [
          [enrollments[0]!.enrollmentId, enrollments[1]!.enrollmentId],
          [enrollments[2]!.enrollmentId, enrollments[3]!.enrollmentId],
        ],
        plannedBy: "operator:deployment",
        plannedAt: "2026-08-27T00:04:00.000Z",
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid_fleet_rollout_plan" }));
  });

  it("advances only from exact ready evidence with separate approval and execution authority", async () => {
    const fixtures = await Promise.all([enrollment(1), enrollment(2)]);
    const enrollments = fixtures.map((fixture) => fixture.enrollment);
    const sourcePolicy = policy();
    const plan = createOrganizationFleetRolloutPlan({
      policy: sourcePolicy,
      enrollments,
      targetRuntimeVersion: "0.4.0",
      targetArtifactHash,
      waves: [[enrollments[0]!.enrollmentId], [enrollments[1]!.enrollmentId]],
      plannedBy: "operator:deployment",
      plannedAt: "2026-08-27T00:04:00.000Z",
    });
    const canaryApproval = createOrganizationFleetRolloutApproval({
      policy: sourcePolicy,
      plan,
      waveNumber: 1,
      action: "execute_wave",
      approvedBy: "operator:approval",
      approvedAt: "2026-08-27T00:05:00.000Z",
    });
    expect(canaryApproval.effect).toEqual({
      deployment: "not_executed",
      rollback: "not_executed",
      approval: "granted",
    });
    expect(() =>
      assertOrganizationFleetRolloutExecutionAuthority({
        policy: sourcePolicy,
        plan,
        approval: canaryApproval,
        principalId: "operator:approval",
        at: "2026-08-27T00:06:00.000Z",
      }),
    ).toThrowError(expect.objectContaining({ code: "organization_authority_denied" }));
    expect(() =>
      assertOrganizationFleetRolloutExecutionAuthority({
        policy: sourcePolicy,
        plan,
        approval: canaryApproval,
        principalId: "operator:execution",
        at: "2026-08-27T00:06:00.000Z",
      }),
    ).not.toThrow();

    const observation = createOrganizationFleetWaveObservation({
      policy: sourcePolicy,
      plan,
      enrollments,
      waveNumber: 1,
      nodes: [readyNode(enrollments[0]!)],
      observedBy: "operator:deployment",
      observedAt: "2026-08-27T00:07:00.000Z",
    });
    expect(evaluateOrganizationFleetWave({ plan, observation })).toEqual({
      state: "ready_to_advance",
      failures: [],
    });
    expect(
      createOrganizationFleetRolloutApproval({
        policy: sourcePolicy,
        plan,
        waveNumber: 2,
        action: "execute_wave",
        observation,
        approvedBy: "operator:approval",
        approvedAt: "2026-08-27T00:08:00.000Z",
      }),
    ).toMatchObject({
      waveNumber: 2,
      action: "execute_wave",
      evidenceObservationId: observation.observationId,
    });
  });

  it("holds incomplete evidence and requires explicit rollback approval for failures", async () => {
    const fixtures = await Promise.all([enrollment(1), enrollment(2)]);
    const enrollments = fixtures.map((fixture) => fixture.enrollment);
    const sourcePolicy = policy();
    const plan = createOrganizationFleetRolloutPlan({
      policy: sourcePolicy,
      enrollments,
      targetRuntimeVersion: "0.4.0",
      targetArtifactHash,
      waves: [[enrollments[0]!.enrollmentId], [enrollments[1]!.enrollmentId]],
      plannedBy: "operator:deployment",
      plannedAt: "2026-08-27T00:04:00.000Z",
    });
    const pending = createOrganizationFleetWaveObservation({
      policy: sourcePolicy,
      plan,
      enrollments,
      waveNumber: 1,
      nodes: [readyNode(enrollments[0]!, { status: "pending", consecutiveObservations: 1 })],
      observedBy: "operator:deployment",
      observedAt: "2026-08-27T00:07:00.000Z",
    });
    expect(evaluateOrganizationFleetWave({ plan, observation: pending })).toMatchObject({
      state: "hold",
      failures: ["readiness_incomplete"],
    });
    expect(() =>
      createOrganizationFleetRolloutApproval({
        policy: sourcePolicy,
        plan,
        waveNumber: 2,
        action: "execute_wave",
        observation: pending,
        approvedBy: "operator:approval",
        approvedAt: "2026-08-27T00:08:00.000Z",
      }),
    ).toThrowError(expect.objectContaining({ code: "fleet_wave_gate_not_satisfied" }));

    const failed = createOrganizationFleetWaveObservation({
      policy: sourcePolicy,
      plan,
      enrollments,
      waveNumber: 1,
      nodes: [
        readyNode(enrollments[0]!, {
          status: "degraded",
          runtimeArtifactHash: initialArtifactHash,
        }),
      ],
      observedBy: "operator:deployment",
      observedAt: "2026-08-27T00:09:00.000Z",
    });
    expect(evaluateOrganizationFleetWave({ plan, observation: failed })).toEqual({
      state: "rollback_required",
      failures: ["readiness_incomplete", "target_artifact_mismatch"],
    });
    const rollback = createOrganizationFleetRolloutApproval({
      policy: sourcePolicy,
      plan,
      waveNumber: 1,
      action: "rollback_wave",
      observation: failed,
      approvedBy: "operator:approval",
      approvedAt: "2026-08-27T00:10:00.000Z",
    });
    expect(() =>
      assertOrganizationFleetRolloutExecutionAuthority({
        policy: sourcePolicy,
        plan,
        approval: rollback,
        principalId: "operator:execution",
        at: "2026-08-27T00:11:00.000Z",
      }),
    ).toThrowError(expect.objectContaining({ code: "fleet_wave_gate_not_satisfied" }));
    expect(() =>
      assertOrganizationFleetRolloutExecutionAuthority({
        policy: sourcePolicy,
        plan,
        approval: rollback,
        observation: failed,
        principalId: "operator:execution",
        at: "2026-08-27T00:11:00.000Z",
      }),
    ).not.toThrow();
  });
});

describe("organization Node rollout execution", () => {
  async function executionFixture() {
    const fixtures = await Promise.all([enrollment(1), enrollment(2)]);
    const enrollments = fixtures.map((fixture) => fixture.enrollment);
    const sourcePolicy = policy();
    const rolloutPlan = createOrganizationFleetRolloutPlan({
      policy: sourcePolicy,
      enrollments,
      targetRuntimeVersion: "0.4.0",
      targetArtifactHash,
      waves: [[enrollments[0]!.enrollmentId], [enrollments[1]!.enrollmentId]],
      plannedBy: "operator:deployment",
      plannedAt: "2026-08-27T00:04:00.000Z",
    });
    const approval = createOrganizationFleetRolloutApproval({
      policy: sourcePolicy,
      plan: rolloutPlan,
      waveNumber: 1,
      action: "execute_wave",
      approvedBy: "operator:approval",
      approvedAt: "2026-08-27T00:05:00.000Z",
    });
    return { sourcePolicy, rolloutPlan, approval, enrollments };
  }

  it("revalidates one approved wave member and binds its exact local apply receipt", async () => {
    const fixture = await executionFixture();
    const enrollment = fixture.enrollments[0]!;
    let localPlanHash = `sha256:${"d".repeat(64)}`;
    let applyCalls = 0;
    const port = {
      plan: async () => ({
        nodeId: enrollment.nodeId,
        destinationId: enrollment.destinationId,
        projectId: enrollment.target.projectId,
        projectIdentityHash: enrollment.target.projectIdentityHash,
        targetRuntimeVersion: "0.4.0",
        targetArtifactHash,
        localPlanId: `nfp_${"a".repeat(24)}`,
        localPlanHash,
      }),
      apply: async () => {
        applyCalls += 1;
        return {
          nodeId: enrollment.nodeId,
          destinationId: enrollment.destinationId,
          projectId: enrollment.target.projectId,
          projectIdentityHash: enrollment.target.projectIdentityHash,
          targetRuntimeVersion: "0.4.0",
          targetArtifactHash,
          localPlanId: `nfp_${"a".repeat(24)}`,
          localPlanHash,
          localApplyReceiptHash: `sha256:${"e".repeat(64)}`,
          completedAt: "2026-08-27T00:06:30.000Z",
          effect: "applied" as const,
        };
      },
    };
    const executionPlan = await createOrganizationNodeRolloutExecutionPlan({
      policy: fixture.sourcePolicy,
      rolloutPlan: fixture.rolloutPlan,
      approval: fixture.approval,
      enrollment,
      executedBy: "operator:execution",
      plannedAt: "2026-08-27T00:06:00.000Z",
      port,
    });
    expect(executionPlan).toMatchObject({
      executionPlanId: expect.stringMatching(/^oxp_[a-f0-9]{64}$/u),
      enrollmentId: enrollment.enrollmentId,
      localPlanHash,
      effect: { deployment: "not_executed", rollback: "not_executed" },
      secretMaterial: "excluded",
    });

    const receipt = await applyOrganizationNodeRolloutExecution({
      executionPlan,
      policy: fixture.sourcePolicy,
      rolloutPlan: fixture.rolloutPlan,
      approval: fixture.approval,
      enrollment,
      executedAt: "2026-08-27T00:06:15.000Z",
      port,
    });
    expect(receipt).toMatchObject({
      executionReceiptId: expect.stringMatching(/^oxr_[a-f0-9]{64}$/u),
      executionPlanId: executionPlan.executionPlanId,
      localApplyReceiptHash: `sha256:${"e".repeat(64)}`,
      effect: { deployment: "executed", rollback: "not_executed" },
      secretMaterial: "excluded",
    });
    expect(applyCalls).toBe(1);
    expect(JSON.stringify(receipt)).not.toContain("runtime-token");

    localPlanHash = `sha256:${"f".repeat(64)}`;
    await expect(
      applyOrganizationNodeRolloutExecution({
        executionPlan,
        policy: fixture.sourcePolicy,
        rolloutPlan: fixture.rolloutPlan,
        approval: fixture.approval,
        enrollment,
        executedAt: "2026-08-27T00:07:00.000Z",
        port,
      }),
    ).rejects.toMatchObject({ code: "invalid_node_rollout_execution_plan" });
    expect(applyCalls).toBe(1);
  });

  it("rejects a different wave member and rollback approval before local planning", async () => {
    const fixture = await executionFixture();
    let planCalls = 0;
    const port = {
      plan: async () => {
        planCalls += 1;
        throw new Error("must not plan");
      },
      apply: async () => {
        throw new Error("must not apply");
      },
    };
    await expect(
      createOrganizationNodeRolloutExecutionPlan({
        policy: fixture.sourcePolicy,
        rolloutPlan: fixture.rolloutPlan,
        approval: fixture.approval,
        enrollment: fixture.enrollments[1]!,
        executedBy: "operator:execution",
        plannedAt: "2026-08-27T00:06:00.000Z",
        port,
      }),
    ).rejects.toMatchObject({ code: "invalid_node_rollout_execution_plan" });
    expect(planCalls).toBe(0);

    const failed = createOrganizationFleetWaveObservation({
      policy: fixture.sourcePolicy,
      plan: fixture.rolloutPlan,
      enrollments: fixture.enrollments,
      waveNumber: 1,
      nodes: [
        readyNode(fixture.enrollments[0]!, {
          status: "degraded",
          runtimeArtifactHash: initialArtifactHash,
        }),
      ],
      observedBy: "operator:deployment",
      observedAt: "2026-08-27T00:07:00.000Z",
    });
    const rollbackApproval = createOrganizationFleetRolloutApproval({
      policy: fixture.sourcePolicy,
      plan: fixture.rolloutPlan,
      waveNumber: 1,
      action: "rollback_wave",
      observation: failed,
      approvedBy: "operator:approval",
      approvedAt: "2026-08-27T00:08:00.000Z",
    });
    await expect(
      createOrganizationNodeRolloutExecutionPlan({
        policy: fixture.sourcePolicy,
        rolloutPlan: fixture.rolloutPlan,
        approval: rollbackApproval,
        observation: failed,
        enrollment: fixture.enrollments[0]!,
        executedBy: "operator:execution",
        plannedAt: "2026-08-27T00:09:00.000Z",
        port,
      }),
    ).rejects.toMatchObject({ code: "invalid_node_rollout_execution_plan" });
    expect(planCalls).toBe(0);
  });

  it("authenticates approval authorship and replays one completed delivery without reapplying", async () => {
    const fixture = await executionFixture();
    const enrollment = fixture.enrollments[0]!;
    let applyCalls = 0;
    const local = {
      plan: async () => ({
        nodeId: enrollment.nodeId,
        destinationId: enrollment.destinationId,
        projectId: enrollment.target.projectId,
        projectIdentityHash: enrollment.target.projectIdentityHash,
        targetRuntimeVersion: "0.4.0",
        targetArtifactHash,
        localPlanId: `nfp_${"a".repeat(24)}`,
        localPlanHash: `sha256:${"d".repeat(64)}`,
      }),
      apply: async () => {
        applyCalls += 1;
        return {
          nodeId: enrollment.nodeId,
          destinationId: enrollment.destinationId,
          projectId: enrollment.target.projectId,
          projectIdentityHash: enrollment.target.projectIdentityHash,
          targetRuntimeVersion: "0.4.0",
          targetArtifactHash,
          localPlanId: `nfp_${"a".repeat(24)}`,
          localPlanHash: `sha256:${"d".repeat(64)}`,
          localApplyReceiptHash: `sha256:${"e".repeat(64)}`,
          completedAt: "2026-08-27T00:06:30.000Z",
          effect: "applied" as const,
        };
      },
    };
    const executionPlan = await createOrganizationNodeRolloutExecutionPlan({
      policy: fixture.sourcePolicy,
      rolloutPlan: fixture.rolloutPlan,
      approval: fixture.approval,
      enrollment,
      executedBy: "operator:execution",
      plannedAt: "2026-08-27T00:06:00.000Z",
      port: local,
    });
    const policyKeys = generateKeyPairSync("ed25519");
    const approvalKeys = generateKeyPairSync("ed25519");
    const policyKeyId = "key_organization_policy_01";
    const approvalKeyId = "key_organization_approval_01";
    const signedPolicy = createSignedOrganizationDeploymentPolicy({
      policy: fixture.sourcePolicy,
      keyId: policyKeyId,
      signature: sign(
        null,
        organizationDeploymentPolicySigningBytes({
          policy: fixture.sourcePolicy,
          keyId: policyKeyId,
        }),
        policyKeys.privateKey,
      ),
    });
    const delivery = createOrganizationNodeRolloutDelivery({
      idempotencyKey: "idk_organization_rollout_01",
      nonce: "a".repeat(43),
      issuedAt: "2026-08-27T00:06:00.000Z",
      expiresAt: "2026-08-27T00:10:00.000Z",
      target: project,
      nodeId: enrollment.nodeId,
      destinationId: enrollment.destinationId,
      signedPolicy,
      rolloutPlan: fixture.rolloutPlan,
      approval: fixture.approval,
      observation: null,
      enrollment,
      executionPlan,
    });
    const envelope = createSignedOrganizationNodeRolloutDelivery({
      delivery,
      keyId: approvalKeyId,
      signature: sign(
        null,
        organizationNodeRolloutDeliverySigningBytes({ delivery, keyId: approvalKeyId }),
        approvalKeys.privateKey,
      ),
    });
    const trustStore = {
      async find(input: { purpose: "policy" | "approval"; keyId: string }) {
        if (input.purpose === "policy" && input.keyId === policyKeyId) {
          return {
            purpose: "policy" as const,
            keyId: policyKeyId,
            organizationIds: [fixture.sourcePolicy.organizationId],
            projects: [project],
            verify: async (candidate: { message: Uint8Array; signature: Uint8Array }) =>
              verify(null, candidate.message, policyKeys.publicKey, candidate.signature),
          };
        }
        if (input.purpose === "approval" && input.keyId === approvalKeyId) {
          return {
            purpose: "approval" as const,
            keyId: approvalKeyId,
            principalId: "operator:approval",
            organizationIds: [fixture.sourcePolicy.organizationId],
            projects: [project],
            verify: async (candidate: { message: Uint8Array; signature: Uint8Array }) =>
              verify(null, candidate.message, approvalKeys.publicKey, candidate.signature),
          };
        }
        return null;
      },
    };
    let reserved = false;
    let stored:
      | Awaited<ReturnType<typeof applyAuthenticatedOrganizationNodeRolloutDelivery>>["receipt"]
      | null = null;
    const replayStore = {
      async inspect() {
        return stored === null
          ? reserved
            ? ({ status: "in_progress" } as const)
            : ({ status: "available" } as const)
          : ({ status: "duplicate", receipt: stored } as const);
      },
      async reserve() {
        if (stored !== null) return { status: "duplicate", receipt: stored } as const;
        if (reserved) return { status: "in_progress" } as const;
        reserved = true;
        return { status: "reserved", reservationId: "reservation-01" } as const;
      },
      async complete(input: { receipt: typeof stored }) {
        stored = structuredClone(input.receipt!);
      },
    };
    const request = {
      envelope,
      nodeId: enrollment.nodeId,
      destinationId: enrollment.destinationId,
      target: project,
      trustStore,
      replayStore,
      local,
      now: "2026-08-27T00:06:15.000Z",
    };
    await expect(applyAuthenticatedOrganizationNodeRolloutDelivery(request)).resolves.toMatchObject(
      {
        status: "executed",
        receipt: {
          deliveryReceiptId: expect.stringMatching(/^odr_[a-f0-9]{64}$/u),
          executionReceipt: { effect: { deployment: "executed" } },
          secretMaterial: "excluded",
        },
      },
    );
    await expect(applyAuthenticatedOrganizationNodeRolloutDelivery(request)).resolves.toMatchObject(
      { status: "duplicate" },
    );
    expect(applyCalls).toBe(1);

    const deniedTrust = {
      ...trustStore,
      async find(input: { purpose: "policy" | "approval"; keyId: string }) {
        const signer = await trustStore.find(input);
        return signer?.purpose === "approval"
          ? { ...signer, principalId: "operator:different" }
          : signer;
      },
    };
    await expect(
      applyAuthenticatedOrganizationNodeRolloutDelivery({
        ...request,
        trustStore: deniedTrust,
        replayStore: { ...replayStore, inspect: async () => ({ status: "available" as const }) },
      }),
    ).rejects.toMatchObject({ code: "node_rollout_delivery_signer_denied" });

    let uncertainReserved = false;
    let uncertainApplyCalls = 0;
    const uncertainReplay = {
      async inspect() {
        return uncertainReserved
          ? ({ status: "in_progress" } as const)
          : ({ status: "available" } as const);
      },
      async reserve() {
        uncertainReserved = true;
        return { status: "reserved", reservationId: "reservation-uncertain" } as const;
      },
      async complete() {
        throw new Error("must not complete");
      },
    };
    const uncertainRequest = {
      ...request,
      replayStore: uncertainReplay,
      local: {
        plan: local.plan,
        async apply() {
          uncertainApplyCalls += 1;
          throw new Error("uncertain local effect");
        },
      },
    };
    await expect(
      applyAuthenticatedOrganizationNodeRolloutDelivery(uncertainRequest),
    ).rejects.toMatchObject({ code: "node_rollout_execution_failed" });
    await expect(
      applyAuthenticatedOrganizationNodeRolloutDelivery(uncertainRequest),
    ).rejects.toMatchObject({ code: "node_rollout_delivery_in_progress" });
    expect(uncertainApplyCalls).toBe(1);
  });
});
