import { generateKeyPairSync, sign } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  createOrganizationDeploymentPolicy,
  createOrganizationFleetRolloutApproval,
  createOrganizationFleetRolloutPlan,
  createOrganizationNodeEnrollment,
  createOrganizationNodeRolloutDelivery,
  createOrganizationNodeRolloutExecutionPlan,
  createOrganizationRuntimeCredentialGrant,
  createSignedOrganizationDeploymentPolicy,
  createSignedOrganizationNodeRolloutDelivery,
  deliverOrganizationRuntimeCredential,
  organizationDeploymentPolicySigningBytes,
  organizationNodeRolloutDeliverySigningBytes,
} from "@lervo/organization-deployment-contract";
import { calculateNodeFleetServiceInstanceId } from "@lervo/repository-registry";
import type {
  OrganizationNodeRolloutDeliveryReceipt,
  OrganizationNodeRolloutRecoveryObservation,
  OrganizationNodeRolloutRecoveryReceipt,
  ProjectManifest,
} from "@lervo/schemas";
import { calculateProjectIdentityHash } from "@lervo/sync-contract";
import { afterEach, describe, expect, it } from "vitest";

import {
  executeInstalledOrganizationNodeRolloutDelivery,
  recoverInstalledOrganizationNodeRolloutDelivery,
} from "../src/organization-node-rollout-delivery.js";

const roots: string[] = [];
const nodeId = "node_organization01";
const destinationId = "hub:organization:1";
const targetArtifactHash = `sha256:${"c".repeat(64)}`;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function ownerFile(path: string, value: string): Promise<void> {
  await writeFile(path, value, { mode: 0o600 });
  await chmod(path, 0o600);
}

async function deliveryFixture(root: string) {
  const manifest: ProjectManifest = {
    schemaVersion: 1,
    projectId: "prj_organization01",
    name: "organization-rollout-test",
    root: ".",
    createdAt: "2026-08-27T00:00:00.000Z",
    dataPolicy: {
      eventMetadataRetentionDays: 90,
      artifactRetentionDays: 30,
      persistRawPrompts: false,
      persistDocumentBodiesInEvents: false,
      hubSyncEnabled: true,
      eventPayloadMode: "allowlist",
    },
  };
  const target = {
    projectId: manifest.projectId,
    projectIdentityHash: calculateProjectIdentityHash(manifest),
  };
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
  let applyCalls = 0;
  let recoveryObservation: OrganizationNodeRolloutRecoveryObservation = {
    localPlanId: `nfp_${"3".repeat(24)}`,
    localPlanHash: `sha256:${"4".repeat(64)}`,
    registry: "register" as const,
    serviceTarget: "absent" as const,
    legacyTarget: "absent" as const,
    privacy: {
      absolutePaths: "excluded" as const,
      credentials: "excluded" as const,
      serviceDefinitionBodies: "excluded" as const,
    },
  };
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
    apply: async () => {
      applyCalls += 1;
      return {
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
      };
    },
    inspectEffect: async () => structuredClone(recoveryObservation),
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
  const delivery = createOrganizationNodeRolloutDelivery({
    idempotencyKey: "idk_organization_rollout_01",
    nonce: "a".repeat(43),
    issuedAt: "2026-08-27T00:06:00.000Z",
    expiresAt: "2026-08-27T00:10:00.000Z",
    target,
    nodeId,
    destinationId,
    signedPolicy,
    rolloutPlan,
    approval,
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
  const keyDirectory = resolve(root, "keys");
  await mkdir(keyDirectory, { mode: 0o700 });
  await Promise.all([
    ownerFile(
      resolve(keyDirectory, "policy.pem"),
      String(policyKeys.publicKey.export({ type: "spki", format: "pem" })),
    ),
    ownerFile(
      resolve(keyDirectory, "approval.pem"),
      String(approvalKeys.publicKey.export({ type: "spki", format: "pem" })),
    ),
  ]);
  const requestPath = resolve(root, "delivery.json");
  const trustPath = resolve(root, "trust.json");
  await ownerFile(requestPath, JSON.stringify(envelope));
  const writeTrust = (principalId: string) =>
    ownerFile(
      trustPath,
      JSON.stringify({
        schemaVersion: 1,
        policyKeys: [
          {
            keyId: policyKeyId,
            publicKeyFile: "keys/policy.pem",
            organizationIds: [policy.organizationId],
            projects: [target],
          },
        ],
        approvalKeys: [
          {
            keyId: approvalKeyId,
            principalId,
            publicKeyFile: "keys/approval.pem",
            organizationIds: [policy.organizationId],
            projects: [target],
          },
        ],
      }),
    );
  await writeTrust("operator:approval");
  return {
    manifest,
    target,
    local,
    requestPath,
    trustPath,
    writeTrust,
    setRecoveryApplied() {
      recoveryObservation = {
        ...recoveryObservation,
        localPlanId: `nfp_${"6".repeat(24)}`,
        localPlanHash: `sha256:${"7".repeat(64)}`,
        registry: "unchanged",
        serviceTarget: "desired",
      };
    },
    get applyCalls() {
      return applyCalls;
    },
  };
}

describe("installed organization Node rollout delivery", () => {
  it("loads owner-only authenticated material and executes one replay-reserved transaction", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-org-rollout-delivery-"));
    roots.push(root);
    const fixture = await deliveryFixture(root);
    let reserved = false;
    let stored: OrganizationNodeRolloutDeliveryReceipt | null = null;
    let closed = false;
    const replayStore = {
      async inspect() {
        return stored === null
          ? reserved
            ? ({ status: "in_progress" } as const)
            : ({ status: "available" } as const)
          : ({ status: "duplicate", receipt: stored } as const);
      },
      async reserve() {
        reserved = true;
        return { status: "reserved", reservationId: "reservation-01" } as const;
      },
      async complete(input: { receipt: OrganizationNodeRolloutDeliveryReceipt }) {
        stored = structuredClone(input.receipt);
      },
      close() {
        closed = true;
      },
    };
    const input = {
      requestPath: fixture.requestPath,
      trustPath: fixture.trustPath,
      replayPath: resolve(root, "replay.sqlite"),
      binding: {
        registryPath: resolve(root, "registry.json"),
        repositoryRoot: root,
        nodeId,
        destinationId,
        serviceManager: "launchd" as const,
        configPath: resolve(root, "node.json"),
        executablePath: resolve(root, "node-runtime.js"),
      },
    };
    await expect(
      executeInstalledOrganizationNodeRolloutDelivery(input, {
        loadManifest: async () => structuredClone(fixture.manifest),
        createLocalPort: () => fixture.local,
        openReplayStore: async () => replayStore,
        now: () => new Date("2026-08-27T00:06:15.000Z"),
      }),
    ).resolves.toMatchObject({ status: "executed", receipt: { secretMaterial: "excluded" } });
    expect(fixture.applyCalls).toBe(1);
    expect(closed).toBe(true);

    await fixture.writeTrust("operator:different");
    await expect(
      executeInstalledOrganizationNodeRolloutDelivery(input, {
        loadManifest: async () => structuredClone(fixture.manifest),
        createLocalPort: () => fixture.local,
        openReplayStore: async () => ({
          ...replayStore,
          inspect: async () => ({ status: "available" as const }),
        }),
        now: () => new Date("2026-08-27T00:06:15.000Z"),
      }),
    ).rejects.toMatchObject({ code: "node_rollout_delivery_signer_denied" });
    expect(fixture.applyCalls).toBe(1);
  });

  it("persists an unresolved-state classification without replaying apply", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-org-rollout-recovery-"));
    roots.push(root);
    const fixture = await deliveryFixture(root);
    const baseline = await fixture.local.inspectEffect();
    fixture.setRecoveryApplied();
    let persisted: OrganizationNodeRolloutRecoveryReceipt | null = null;
    const result = await recoverInstalledOrganizationNodeRolloutDelivery(
      {
        requestPath: fixture.requestPath,
        trustPath: fixture.trustPath,
        replayPath: resolve(root, "replay.sqlite"),
        binding: {
          registryPath: resolve(root, "registry.json"),
          repositoryRoot: root,
          nodeId,
          destinationId,
          serviceManager: "launchd",
          configPath: resolve(root, "node.json"),
          executablePath: resolve(root, "node-runtime.js"),
        },
      },
      {
        loadManifest: async () => structuredClone(fixture.manifest),
        createLocalPort: () => fixture.local,
        openReplayStore: async () => ({
          inspect: async () => ({ status: "in_progress" as const }),
          reserve: async () => ({ status: "in_progress" as const }),
          complete: async () => undefined,
          inspectRecovery: async () => ({
            status: "recoverable" as const,
            reservationId: "reservation-01",
            baseline,
            receipt: persisted,
          }),
          recordRecovery: async ({ receipt }) => {
            persisted = structuredClone(receipt);
            return structuredClone(receipt);
          },
          close: () => undefined,
        }),
        now: () => new Date("2026-08-27T00:07:00.000Z"),
      },
    );
    expect(result).toMatchObject({ status: "inspected", receipt: { classification: "applied" } });
    expect(persisted).toMatchObject({ effect: { deployment: "not_executed" } });
    expect(fixture.applyCalls).toBe(0);
  });
});
