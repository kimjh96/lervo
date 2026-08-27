import {
  applyOrganizationNodeRolloutRollback,
  createOrganizationDeploymentPolicy,
  createOrganizationFleetRolloutApproval,
  createOrganizationFleetRolloutPlan,
  createOrganizationFleetWaveObservation,
  createOrganizationNodeEnrollment,
  createOrganizationNodeRolloutRollbackPlan,
  createOrganizationRuntimeCredentialGrant,
  deliverOrganizationRuntimeCredential,
} from "../src/index.js";
import { calculateNodeFleetServiceInstanceId } from "@lervo/repository-registry";
import { describe, expect, it } from "vitest";

const target = {
  projectId: "prj_organization01",
  projectIdentityHash: `sha256:${"a".repeat(64)}`,
};
const failedArtifactHash = `sha256:${"b".repeat(64)}`;
const predecessorArtifactHash = `sha256:${"c".repeat(64)}`;

async function rollbackFixture() {
  const policy = createOrganizationDeploymentPolicy({
    organizationId: "org_example01",
    sequence: 1,
    previousPolicyId: null,
    issuedAt: "2026-08-27T00:00:00.000Z",
    expiresAt: "2026-08-28T00:00:00.000Z",
    tenancy: { mode: "strict_project", projects: [target] },
    authorities: [
      {
        principalId: "operator:approval",
        permissions: ["rollout.approve"],
        projectIds: [target.projectId],
      },
      {
        principalId: "operator:rollback",
        permissions: ["rollout.execute", "rollout.rollback"],
        projectIds: [target.projectId],
      },
      {
        principalId: "operator:deployment",
        permissions: ["deployment.plan", "node.enroll"],
        projectIds: [target.projectId],
      },
      {
        principalId: "operator:security",
        permissions: ["credential.issue"],
        projectIds: [target.projectId],
      },
      {
        principalId: "operator:delivery",
        permissions: ["credential.deliver"],
        projectIds: [target.projectId],
      },
    ],
    credentialPolicy: {
      deliveryMode: "runtime_only",
      separationOfDuties: "issuer_and_deliverer_distinct",
      maximumTtlSeconds: 3_600,
      maximumRotationOverlapSeconds: 300,
      allowedPermissions: ["sync.write"],
    },
  });
  const grant = createOrganizationRuntimeCredentialGrant({
    policy,
    target,
    nodeId: "node_organization01",
    destinationId: "hub:organization:1",
    subjectPrincipalId: "node:organization01",
    permissions: ["sync.write"],
    issuedBy: "operator:security",
    issuedAt: "2026-08-27T00:01:00.000Z",
    notBefore: "2026-08-27T00:01:00.000Z",
    expiresAt: "2026-08-27T01:01:00.000Z",
  });
  const deliveryReceipt = await deliverOrganizationRuntimeCredential({
    policy,
    grant,
    deliveredBy: "operator:delivery",
    deliveredAt: "2026-08-27T00:02:00.000Z",
    source: { load: async () => new TextEncoder().encode("a".repeat(48)) },
    consumer: { activate: async () => undefined },
  });
  const enrollment = createOrganizationNodeEnrollment({
    policy,
    grant,
    deliveryReceipt,
    serviceInstanceId: calculateNodeFleetServiceInstanceId({
      projectId: target.projectId,
      repositoryIdentityHash: target.projectIdentityHash,
      nodeId: grant.nodeId,
    }),
    runtimeVersion: "0.3.1",
    runtimeArtifactHash: predecessorArtifactHash,
    localPlanId: `nfp_${"1".repeat(24)}`,
    localApplyReceiptHash: `sha256:${"2".repeat(64)}`,
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
  });
  const rolloutPlan = createOrganizationFleetRolloutPlan({
    policy,
    enrollments: [enrollment],
    targetRuntimeVersion: "0.4.0",
    targetArtifactHash: failedArtifactHash,
    waves: [[enrollment.enrollmentId]],
    plannedBy: "operator:deployment",
    plannedAt: "2026-08-27T00:04:00.000Z",
  });
  const observation = createOrganizationFleetWaveObservation({
    policy,
    plan: rolloutPlan,
    enrollments: [enrollment],
    waveNumber: 1,
    nodes: [
      {
        enrollmentId: enrollment.enrollmentId,
        nodeId: enrollment.nodeId,
        runtimeVersion: "0.4.0",
        runtimeArtifactHash: failedArtifactHash,
        readiness: {
          status: "degraded",
          consecutiveObservations: 0,
          sync: "unavailable",
          workstreamReplication: "unavailable",
          workspaceCoordination: "disabled",
          remoteControl: "unavailable",
        },
      },
    ],
    observedBy: "operator:deployment",
    observedAt: "2026-08-27T00:05:00.000Z",
  });
  const approval = createOrganizationFleetRolloutApproval({
    policy,
    plan: rolloutPlan,
    waveNumber: 1,
    action: "rollback_wave",
    observation,
    approvedBy: "operator:approval",
    approvedAt: "2026-08-27T00:06:00.000Z",
  });
  return { policy, enrollment, rolloutPlan, observation, approval };
}

describe("organization Node predecessor-bound rollback", () => {
  it("binds the failed target, enrolled predecessor, local plan, and explicit rollback effect", async () => {
    const fixture = await rollbackFixture();
    let localPlanHash = `sha256:${"d".repeat(64)}`;
    let rollbackCalls = 0;
    const local = {
      plan: async () => ({
        nodeId: fixture.enrollment.nodeId,
        destinationId: fixture.enrollment.destinationId,
        projectId: target.projectId,
        projectIdentityHash: target.projectIdentityHash,
        failedRuntimeVersion: "0.4.0",
        failedArtifactHash,
        predecessorRuntimeVersion: "0.3.1",
        predecessorArtifactHash,
        localPlanId: `nfp_${"3".repeat(24)}`,
        localPlanHash,
      }),
      rollback: async () => {
        rollbackCalls += 1;
        return {
          nodeId: fixture.enrollment.nodeId,
          destinationId: fixture.enrollment.destinationId,
          projectId: target.projectId,
          projectIdentityHash: target.projectIdentityHash,
          failedRuntimeVersion: "0.4.0",
          failedArtifactHash,
          predecessorRuntimeVersion: "0.3.1",
          predecessorArtifactHash,
          localPlanId: `nfp_${"3".repeat(24)}`,
          localPlanHash,
          localApplyReceiptHash: `sha256:${"e".repeat(64)}`,
          completedAt: "2026-08-27T00:07:30.000Z",
          effect: "rolled_back" as const,
        };
      },
    };
    const rollbackPlan = await createOrganizationNodeRolloutRollbackPlan({
      ...fixture,
      rolledBackBy: "operator:rollback",
      plannedAt: "2026-08-27T00:07:00.000Z",
      port: local,
    });
    expect(rollbackPlan).toMatchObject({
      rollbackPlanId: expect.stringMatching(/^orb_[a-f0-9]{64}$/u),
      action: "rollback_wave",
      failedArtifactHash,
      predecessorArtifactHash,
      effect: { deployment: "not_executed", rollback: "not_executed" },
      secretMaterial: "excluded",
    });
    const receipt = await applyOrganizationNodeRolloutRollback({
      rollbackPlan,
      ...fixture,
      rolledBackAt: "2026-08-27T00:07:15.000Z",
      port: local,
    });
    expect(receipt).toMatchObject({
      rollbackReceiptId: expect.stringMatching(/^orr_[a-f0-9]{64}$/u),
      rollbackPlanId: rollbackPlan.rollbackPlanId,
      predecessorRuntimeVersion: "0.3.1",
      effect: { deployment: "not_executed", rollback: "executed" },
      secretMaterial: "excluded",
    });
    expect(rollbackCalls).toBe(1);

    localPlanHash = `sha256:${"f".repeat(64)}`;
    await expect(
      applyOrganizationNodeRolloutRollback({
        rollbackPlan,
        ...fixture,
        rolledBackAt: "2026-08-27T00:08:00.000Z",
        port: local,
      }),
    ).rejects.toMatchObject({ code: "invalid_node_rollout_rollback_plan" });
    expect(rollbackCalls).toBe(1);
  });
});
