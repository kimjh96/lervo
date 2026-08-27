import { generateKeyPairSync, sign, verify } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  applyAuthenticatedOrganizationNodeRollbackDelivery,
  createOrganizationDeploymentPolicy,
  createOrganizationFleetRolloutApproval,
  createOrganizationFleetRolloutPlan,
  createOrganizationFleetWaveObservation,
  createOrganizationNodeEnrollment,
  createOrganizationNodeRollbackDelivery,
  createOrganizationNodeRolloutRollbackPlan,
  createOrganizationRuntimeCredentialGrant,
  createSignedOrganizationDeploymentPolicy,
  createSignedOrganizationNodeRollbackDelivery,
  deliverOrganizationRuntimeCredential,
  organizationDeploymentPolicySigningBytes,
  organizationNodeRollbackDeliverySigningBytes,
  recoverAuthenticatedOrganizationNodeRollbackDelivery,
} from "@lervo/organization-deployment-contract";
import { calculateNodeFleetServiceInstanceId } from "@lervo/repository-registry";
import type { OrganizationNodeRolloutRecoveryObservation } from "@lervo/schemas";
import { afterEach, describe, expect, it } from "vitest";

import { SQLiteOrganizationNodeRollbackReplayStore } from "../src/index.js";

const roots: string[] = [];
const target = {
  projectId: "prj_organization01",
  projectIdentityHash: `sha256:${"a".repeat(64)}`,
};
const nodeId = "node_organization01";
const destinationId = "hub:organization:1";
const failedArtifactHash = `sha256:${"b".repeat(64)}`;
const predecessorArtifactHash = `sha256:${"c".repeat(64)}`;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
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
        nodeId,
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
  const baseline: OrganizationNodeRolloutRecoveryObservation = {
    localPlanId: `nfp_${"3".repeat(24)}`,
    localPlanHash: `sha256:${"4".repeat(64)}`,
    registry: "refresh",
    serviceTarget: "other",
    legacyTarget: "absent",
    privacy: {
      absolutePaths: "excluded",
      credentials: "excluded",
      serviceDefinitionBodies: "excluded",
    },
  };
  let current = structuredClone(baseline);
  let rollbackCalls = 0;
  let failAfterEffect = false;
  const local = {
    plan: async () => ({
      nodeId,
      destinationId,
      projectId: target.projectId,
      projectIdentityHash: target.projectIdentityHash,
      failedRuntimeVersion: "0.4.0",
      failedArtifactHash,
      predecessorRuntimeVersion: "0.3.1",
      predecessorArtifactHash,
      localPlanId: baseline.localPlanId,
      localPlanHash: baseline.localPlanHash,
    }),
    rollback: async () => {
      rollbackCalls += 1;
      current = {
        ...baseline,
        localPlanId: `nfp_${"5".repeat(24)}`,
        localPlanHash: `sha256:${"6".repeat(64)}`,
        registry: "unchanged",
        serviceTarget: "desired",
      };
      if (failAfterEffect) throw new Error("response lost after rollback effect");
      return {
        nodeId,
        destinationId,
        projectId: target.projectId,
        projectIdentityHash: target.projectIdentityHash,
        failedRuntimeVersion: "0.4.0",
        failedArtifactHash,
        predecessorRuntimeVersion: "0.3.1",
        predecessorArtifactHash,
        localPlanId: baseline.localPlanId,
        localPlanHash: baseline.localPlanHash,
        localApplyReceiptHash: `sha256:${"7".repeat(64)}`,
        completedAt: "2026-08-27T00:08:30.000Z",
        effect: "rolled_back" as const,
      };
    },
    inspectEffect: async () => structuredClone(current),
  };
  const rollbackPlan = await createOrganizationNodeRolloutRollbackPlan({
    policy,
    rolloutPlan,
    approval,
    observation,
    enrollment,
    rolledBackBy: "operator:rollback",
    plannedAt: "2026-08-27T00:07:00.000Z",
    port: local,
  });
  const policyKeys = generateKeyPairSync("ed25519");
  const approvalKeys = generateKeyPairSync("ed25519");
  const policyKeyId = "key_organization_policy_01";
  const approvalKeyId = "key_organization_approval_01";
  const signedPolicy = createSignedOrganizationDeploymentPolicy({
    policy,
    keyId: policyKeyId,
    signature: sign(
      null,
      organizationDeploymentPolicySigningBytes({ policy, keyId: policyKeyId }),
      policyKeys.privateKey,
    ),
  });
  const trustStore = {
    async find(input: { purpose: "policy" | "approval"; keyId: string }) {
      if (input.purpose === "policy" && input.keyId === policyKeyId) {
        return {
          purpose: "policy" as const,
          keyId: policyKeyId,
          organizationIds: [policy.organizationId],
          projects: [target],
          verify: async (candidate: { message: Uint8Array; signature: Uint8Array }) =>
            verify(null, candidate.message, policyKeys.publicKey, candidate.signature),
        };
      }
      if (input.purpose === "approval" && input.keyId === approvalKeyId) {
        return {
          purpose: "approval" as const,
          keyId: approvalKeyId,
          principalId: "operator:approval",
          organizationIds: [policy.organizationId],
          projects: [target],
          verify: async (candidate: { message: Uint8Array; signature: Uint8Array }) =>
            verify(null, candidate.message, approvalKeys.publicKey, candidate.signature),
        };
      }
      return null;
    },
  };
  function envelope(idempotencyKey: string, nonce: string) {
    const delivery = createOrganizationNodeRollbackDelivery({
      idempotencyKey,
      nonce,
      issuedAt: "2026-08-27T00:07:00.000Z",
      expiresAt: "2026-08-27T00:10:00.000Z",
      target,
      nodeId,
      destinationId,
      signedPolicy,
      rolloutPlan,
      approval,
      observation,
      enrollment,
      rollbackPlan,
    });
    return createSignedOrganizationNodeRollbackDelivery({
      delivery,
      keyId: approvalKeyId,
      signature: sign(
        null,
        organizationNodeRollbackDeliverySigningBytes({ delivery, keyId: approvalKeyId }),
        approvalKeys.privateKey,
      ),
    });
  }
  return {
    local,
    trustStore,
    envelope,
    resetForUncertain() {
      current = structuredClone(baseline);
      failAfterEffect = true;
    },
    get rollbackCalls() {
      return rollbackCalls;
    },
  };
}

describe("organization rollback SQLite replay store", () => {
  it("returns completed duplicates and recovers an uncertain effect without replay", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-org-rollback-replay-"));
    roots.push(root);
    const path = resolve(root, "replay.sqlite");
    const source = await fixture();
    let store = await SQLiteOrganizationNodeRollbackReplayStore.open({
      path,
      target,
      nodeId,
      destinationId,
    });
    const completedEnvelope = source.envelope("idk_organization_rollback_01", "a".repeat(43));
    const request = {
      envelope: completedEnvelope,
      nodeId,
      destinationId,
      target,
      trustStore: source.trustStore,
      replayStore: store,
      local: source.local,
      now: "2026-08-27T00:08:00.000Z",
    };
    await expect(
      applyAuthenticatedOrganizationNodeRollbackDelivery(request),
    ).resolves.toMatchObject({ status: "executed", receipt: { effect: { rollback: "executed" } } });
    expect(source.rollbackCalls).toBe(1);
    store.close();

    store = await SQLiteOrganizationNodeRollbackReplayStore.open({
      path,
      target,
      nodeId,
      destinationId,
    });
    await expect(
      applyAuthenticatedOrganizationNodeRollbackDelivery({
        ...request,
        replayStore: store,
        now: "2026-08-28T00:00:00.000Z",
      }),
    ).resolves.toMatchObject({ status: "duplicate" });
    expect(source.rollbackCalls).toBe(1);

    source.resetForUncertain();
    const uncertainEnvelope = source.envelope("idk_organization_rollback_02", "b".repeat(43));
    await expect(
      applyAuthenticatedOrganizationNodeRollbackDelivery({
        ...request,
        envelope: uncertainEnvelope,
        replayStore: store,
      }),
    ).rejects.toMatchObject({ code: "node_rollout_rollback_failed" });
    expect(source.rollbackCalls).toBe(2);
    store.close();

    store = await SQLiteOrganizationNodeRollbackReplayStore.open({
      path,
      target,
      nodeId,
      destinationId,
    });
    const recovered = await recoverAuthenticatedOrganizationNodeRollbackDelivery({
      ...request,
      envelope: uncertainEnvelope,
      replayStore: store,
      now: "2026-08-27T00:09:00.000Z",
    });
    expect(recovered).toMatchObject({
      status: "inspected",
      receipt: {
        classification: "rolled_back",
        effect: { deployment: "not_executed", rollback: "not_executed" },
        secretMaterial: "excluded",
      },
    });
    await expect(
      recoverAuthenticatedOrganizationNodeRollbackDelivery({
        ...request,
        envelope: uncertainEnvelope,
        replayStore: store,
        now: "2026-08-27T00:09:30.000Z",
      }),
    ).resolves.toMatchObject({ status: "duplicate" });
    expect(source.rollbackCalls).toBe(2);
    store.close();
  });
});
