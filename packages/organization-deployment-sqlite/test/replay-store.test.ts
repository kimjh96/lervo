import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  applyOrganizationNodeRolloutExecution,
  calculateOrganizationNodeRolloutDeliveryHash,
  createOrganizationDeploymentPolicy,
  createOrganizationFleetRolloutApproval,
  createOrganizationFleetRolloutPlan,
  createOrganizationNodeEnrollment,
  createOrganizationNodeRolloutDelivery,
  createOrganizationNodeRolloutDeliveryReceipt,
  createOrganizationNodeRolloutRecoveryReceipt,
  createOrganizationNodeRolloutExecutionPlan,
  createOrganizationRuntimeCredentialGrant,
  createSignedOrganizationDeploymentPolicy,
  deliverOrganizationRuntimeCredential,
} from "@lervo/organization-deployment-contract";
import { calculateNodeFleetServiceInstanceId } from "@lervo/repository-registry";
import { afterEach, describe, expect, it } from "vitest";

import { SQLiteOrganizationNodeRolloutReplayStore } from "../src/index.js";

const roots: string[] = [];
const target = {
  projectId: "prj_organization01",
  projectIdentityHash: `sha256:${"a".repeat(64)}`,
};
const nodeId = "node_organization01";
const destinationId = "hub:organization:1";
const targetArtifactHash = `sha256:${"c".repeat(64)}`;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function completedFixture() {
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
        principalId: "operator:delivery",
        permissions: ["credential.deliver"],
        projectIds: [target.projectId],
      },
      {
        principalId: "operator:deployment",
        permissions: ["deployment.plan", "node.enroll"],
        projectIds: [target.projectId],
      },
      {
        principalId: "operator:execution",
        permissions: ["rollout.execute", "rollout.rollback"],
        projectIds: [target.projectId],
      },
      {
        principalId: "operator:security",
        permissions: ["credential.issue"],
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
    nodeId,
    destinationId,
    subjectPrincipalId: "node:organization01",
    permissions: ["sync.write"],
    issuedBy: "operator:security",
    issuedAt: "2026-08-27T00:01:00.000Z",
    notBefore: "2026-08-27T00:01:00.000Z",
    expiresAt: "2026-08-27T01:01:00.000Z",
  });
  const credentialReceipt = await deliverOrganizationRuntimeCredential({
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
    deliveryReceipt: credentialReceipt,
    serviceInstanceId: calculateNodeFleetServiceInstanceId({
      projectId: target.projectId,
      repositoryIdentityHash: target.projectIdentityHash,
      nodeId,
    }),
    runtimeVersion: "0.3.1",
    runtimeArtifactHash: `sha256:${"b".repeat(64)}`,
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
    targetArtifactHash,
    waves: [[enrollment.enrollmentId]],
    plannedBy: "operator:deployment",
    plannedAt: "2026-08-27T00:04:00.000Z",
  });
  const approval = createOrganizationFleetRolloutApproval({
    policy,
    plan: rolloutPlan,
    waveNumber: 1,
    action: "execute_wave",
    approvedBy: "operator:approval",
    approvedAt: "2026-08-27T00:05:00.000Z",
  });
  const local = {
    plan: async () => ({
      nodeId,
      destinationId,
      projectId: target.projectId,
      projectIdentityHash: target.projectIdentityHash,
      targetRuntimeVersion: "0.4.0",
      targetArtifactHash,
      localPlanId: `nfp_${"3".repeat(24)}`,
      localPlanHash: `sha256:${"4".repeat(64)}`,
    }),
    apply: async () => ({
      nodeId,
      destinationId,
      projectId: target.projectId,
      projectIdentityHash: target.projectIdentityHash,
      targetRuntimeVersion: "0.4.0",
      targetArtifactHash,
      localPlanId: `nfp_${"3".repeat(24)}`,
      localPlanHash: `sha256:${"4".repeat(64)}`,
      localApplyReceiptHash: `sha256:${"5".repeat(64)}`,
      completedAt: "2026-08-27T00:06:30.000Z",
      effect: "applied" as const,
    }),
  };
  const executionPlan = await createOrganizationNodeRolloutExecutionPlan({
    policy,
    rolloutPlan,
    approval,
    enrollment,
    executedBy: "operator:execution",
    plannedAt: "2026-08-27T00:06:00.000Z",
    port: local,
  });
  const executionReceipt = await applyOrganizationNodeRolloutExecution({
    executionPlan,
    policy,
    rolloutPlan,
    approval,
    enrollment,
    executedAt: "2026-08-27T00:06:15.000Z",
    port: local,
  });
  const delivery = createOrganizationNodeRolloutDelivery({
    idempotencyKey: "idk_organization_rollout_01",
    nonce: "a".repeat(43),
    issuedAt: "2026-08-27T00:06:00.000Z",
    expiresAt: "2026-08-27T00:10:00.000Z",
    target,
    nodeId,
    destinationId,
    signedPolicy: createSignedOrganizationDeploymentPolicy({
      policy,
      keyId: "key_organization_policy_01",
      signature: new Uint8Array(64),
    }),
    rolloutPlan,
    approval,
    observation: null,
    enrollment,
    executionPlan,
  });
  return {
    coordinate: {
      deliveryHash: calculateOrganizationNodeRolloutDeliveryHash(delivery),
      idempotencyKey: delivery.idempotencyKey,
      nonce: delivery.nonce,
    },
    receipt: createOrganizationNodeRolloutDeliveryReceipt({ delivery, executionReceipt }),
    delivery,
    baseline: {
      localPlanId: executionPlan.localPlanId,
      localPlanHash: executionPlan.localPlanHash,
      registry: "register" as const,
      serviceTarget: "absent" as const,
      legacyTarget: "absent" as const,
      privacy: {
        absolutePaths: "excluded" as const,
        credentials: "excluded" as const,
        serviceDefinitionBodies: "excluded" as const,
      },
    },
  };
}

describe("organization rollout SQLite replay store", () => {
  it("persists one bounded reservation and completed receipt across reopen", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-org-rollout-replay-"));
    roots.push(root);
    const path = resolve(root, "replay.sqlite");
    const fixture = await completedFixture();
    const store = await SQLiteOrganizationNodeRolloutReplayStore.open({
      path,
      target,
      nodeId,
      destinationId,
      maximumRecords: 1,
    });
    expect(await store.inspect(fixture.coordinate)).toEqual({ status: "available" });
    const reservation = await store.reserve({ ...fixture.coordinate, baseline: fixture.baseline });
    expect(reservation).toMatchObject({ status: "reserved" });
    expect(await store.inspect(fixture.coordinate)).toEqual({ status: "in_progress" });
    await store.complete({
      reservationId: (reservation as { reservationId: string }).reservationId,
      receipt: fixture.receipt,
    });
    expect(await store.inspect(fixture.coordinate)).toMatchObject({
      status: "duplicate",
      receipt: { deliveryReceiptId: fixture.receipt.deliveryReceiptId },
    });
    await expect(
      store.reserve({
        deliveryHash: `sha256:${"f".repeat(64)}`,
        idempotencyKey: "idk_organization_rollout_02",
        nonce: "b".repeat(43),
        baseline: fixture.baseline,
      }),
    ).rejects.toMatchObject({ code: "capacity_exceeded" });
    store.close();

    const reopened = await SQLiteOrganizationNodeRolloutReplayStore.open({
      path,
      target,
      nodeId,
      destinationId,
      maximumRecords: 1,
    });
    expect(await reopened.inspect(fixture.coordinate)).toMatchObject({ status: "duplicate" });
    reopened.close();
    await expect(
      SQLiteOrganizationNodeRolloutReplayStore.open({
        path,
        target,
        nodeId: "node_organization02",
        destinationId,
      }),
    ).rejects.toMatchObject({ code: "integrity_failed" });
  });

  it("persists a bounded recovery projection and never replaces a terminal classification", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-org-rollout-recovery-"));
    roots.push(root);
    const fixture = await completedFixture();
    const store = await SQLiteOrganizationNodeRolloutReplayStore.open({
      path: resolve(root, "replay.sqlite"),
      target,
      nodeId,
      destinationId,
    });
    const reservation = await store.reserve({ ...fixture.coordinate, baseline: fixture.baseline });
    expect(reservation.status).toBe("reserved");
    const current = {
      ...fixture.baseline,
      localPlanId: `nfp_${"6".repeat(24)}`,
      localPlanHash: `sha256:${"7".repeat(64)}`,
      registry: "unchanged" as const,
      serviceTarget: "desired" as const,
    };
    const applied = createOrganizationNodeRolloutRecoveryReceipt({
      delivery: fixture.delivery,
      deliveryHash: fixture.coordinate.deliveryHash,
      baseline: fixture.baseline,
      current,
      inspectedAt: "2026-08-27T00:07:00.000Z",
    });
    await expect(
      store.recordRecovery({
        reservationId: (reservation as { reservationId: string }).reservationId,
        receipt: applied,
      }),
    ).resolves.toMatchObject({ classification: "applied" });
    const laterUnknown = createOrganizationNodeRolloutRecoveryReceipt({
      delivery: fixture.delivery,
      deliveryHash: fixture.coordinate.deliveryHash,
      baseline: fixture.baseline,
      current: { ...current, serviceTarget: "conflict" },
      inspectedAt: "2026-08-27T00:08:00.000Z",
    });
    await expect(
      store.recordRecovery({
        reservationId: (reservation as { reservationId: string }).reservationId,
        receipt: laterUnknown,
      }),
    ).resolves.toMatchObject({ recoveryReceiptId: applied.recoveryReceiptId });
    await expect(store.inspectRecovery(fixture.coordinate)).resolves.toMatchObject({
      status: "recoverable",
      receipt: { recoveryReceiptId: applied.recoveryReceiptId, classification: "applied" },
    });
    store.close();
  });
});
