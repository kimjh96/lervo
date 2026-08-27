import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  applyOrganizationNodeRolloutExecution,
  applyOrganizationNodeRolloutRollback,
  createOrganizationDeploymentPolicy,
  createOrganizationFleetRolloutApproval,
  createOrganizationFleetRolloutPlan,
  createOrganizationFleetWaveObservation,
  createOrganizationNodeEnrollment,
  createOrganizationNodeRolloutExecutionPlan,
  createOrganizationNodeRolloutRollbackPlan,
  createOrganizationRuntimeCredentialGrant,
  deliverOrganizationRuntimeCredential,
  evaluateOrganizationFleetWave,
} from "@lervo/organization-deployment-contract";
import { calculateNodeFleetServiceInstanceId } from "@lervo/repository-registry";
import type { OrganizationNodeEnrollment } from "@lervo/schemas";
import { afterEach, describe, expect, it } from "vitest";

import { createInstalledOrganizationNodeRollbackPort } from "../src/organization-node-rollback.js";
import {
  createInstalledOrganizationNodeRolloutPort,
  organizationRolloutSha256,
} from "../src/organization-node-rollout.js";

const temporaryDirectories: string[] = [];
const project = {
  projectId: "prj_organization01",
  projectIdentityHash: `sha256:${"a".repeat(64)}`,
};
const predecessorArtifactHash = `sha256:${"b".repeat(64)}`;
const targetArtifactHash = `sha256:${"c".repeat(64)}`;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

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

async function enrollNode(sourcePolicy: ReturnType<typeof policy>, index: number) {
  const nodeId = `node_organization0${index}`;
  const destinationId = `hub:organization:${index}`;
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
  const deliveryReceipt = await deliverOrganizationRuntimeCredential({
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
  return createOrganizationNodeEnrollment({
    policy: sourcePolicy,
    grant,
    deliveryReceipt,
    serviceInstanceId: calculateNodeFleetServiceInstanceId({
      projectId: project.projectId,
      repositoryIdentityHash: project.projectIdentityHash,
      nodeId,
    }),
    runtimeVersion: "0.3.1",
    runtimeArtifactHash: predecessorArtifactHash,
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
  });
}

function observedNode(
  enrollment: OrganizationNodeEnrollment,
  status: "ready" | "pending" | "degraded" = "ready",
) {
  return {
    enrollmentId: enrollment.enrollmentId,
    nodeId: enrollment.nodeId,
    runtimeVersion: "0.4.0",
    runtimeArtifactHash: targetArtifactHash,
    readiness: {
      status,
      consecutiveObservations: status === "pending" ? 1 : 3,
      sync: "ready" as const,
      workstreamReplication: "ready" as const,
      workspaceCoordination: "disabled" as const,
      remoteControl: "ready" as const,
    },
  };
}

async function installedForwardPort(
  enrollment: OrganizationNodeEnrollment,
  index: number,
  applied: string[],
) {
  const root = await mkdtemp(resolve(tmpdir(), `lervo-org-multi-${index}-`));
  temporaryDirectories.push(root);
  const repositoryRoot = await realpath(root);
  const planId = `nfp_${String(index + 3).repeat(24)}`;
  const localPlan = {
    schemaVersion: 1 as const,
    planKind: "repository_node_onboarding" as const,
    planId,
    outcome: "reconcile_required" as const,
    verification: "manifest_revalidated" as const,
    desired: {
      serviceInstanceId: enrollment.serviceInstanceId,
      projectId: project.projectId,
      repositoryIdentityHash: project.projectIdentityHash,
      repositoryRoot,
      nodeId: enrollment.nodeId,
      destinationId: enrollment.destinationId,
      runtimeVersion: "0.4.0",
      serviceManager: "launchd" as const,
      serviceIdentity: `com.lervo.node.multi-${index}`,
      healthPath: resolve(root, "health.json"),
    },
    registry: {
      path: resolve(root, "registry.json"),
      reconciliation: "refresh" as const,
      current: null,
    },
    service: {
      targetPath: resolve(root, "service.plist"),
      targetState: "absent" as const,
      targetContentHash: null,
      legacyTargetPath: resolve(root, "legacy.plist"),
      legacyTargetState: "absent" as const,
      legacyTargetContentHash: null,
      activation: "not_observed" as const,
      readiness: "not_observed" as const,
    },
    actions: [],
    privacy: {
      scope: "local_plan_only" as const,
      absolutePaths: "local_output_only" as const,
      credentials: "excluded" as const,
      serviceDefinitionBodies: "excluded" as const,
    },
    staleIf: [
      "project_manifest_changes",
      "fleet_registry_changes",
      "service_target_changes",
      "legacy_service_target_changes",
      "desired_coordinates_change",
    ] as const,
  };
  return createInstalledOrganizationNodeRolloutPort(
    {
      registryPath: resolve(root, "registry.json"),
      repositoryRoot,
      nodeId: enrollment.nodeId,
      destinationId: enrollment.destinationId,
      serviceManager: "launchd",
      configPath: resolve(root, "node.json"),
      executablePath: resolve(root, "node-runtime.js"),
    },
    {
      createPlan: async () => structuredClone(localPlan),
      loadConfig: async () => ({
        schemaVersion: 1,
        repositoryRoot,
        hub: {
          baseUrl: "https://hub.example.test/",
          bearerTokenFile: resolve(root, "token"),
          destinationId: enrollment.destinationId,
          hubIdentityHash: `sha256:${"d".repeat(64)}`,
        },
        sync: { workerId: `worker:${index}` },
        organizationCredentials: { nodeId: enrollment.nodeId },
      }),
      inspectExecutable: async () => ({
        path: resolve(root, "node-runtime.js"),
        artifactHash: targetArtifactHash,
      }),
      applyPlan: async ({ plan }) => {
        applied.push(enrollment.nodeId);
        return {
          schemaVersion: 1,
          operation: "repository_node_onboarding",
          planId: plan.planId,
          service: {
            change: "upgraded",
            managerAvailable: true,
            installed: true,
            active: true,
            enabled: true,
            serviceIdentity: plan.desired.serviceIdentity,
          },
          readiness: {
            status: "ready",
            observations: 3,
            processId: 40 + index,
            startedAt: "2026-08-27T00:09:00.000Z",
            sync: "ready",
            workstreamReplication: "ready",
            workspaceCoordination: "disabled",
            remoteControl: "ready",
          },
          registry: {
            change: "refreshed",
            registration: {
              ...plan.desired,
              registeredAt: "2026-08-27T00:09:00.000Z",
              updatedAt: "2026-08-27T00:09:00.000Z",
            },
          },
        };
      },
      now: () => new Date("2026-08-27T00:09:30.000Z"),
    },
  );
}

async function installedRollbackPort(enrollment: OrganizationNodeEnrollment, rolledBack: string[]) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-org-multi-rollback-"));
  temporaryDirectories.push(root);
  const repositoryRoot = await realpath(root);
  const failedDefinition = "multi-device-failed-service-definition";
  const planId = `nfp_${"f".repeat(24)}`;
  const localPlan = {
    schemaVersion: 1 as const,
    planKind: "repository_node_onboarding" as const,
    planId,
    outcome: "reconcile_required" as const,
    verification: "manifest_revalidated" as const,
    desired: {
      serviceInstanceId: enrollment.serviceInstanceId,
      projectId: project.projectId,
      repositoryIdentityHash: project.projectIdentityHash,
      repositoryRoot,
      nodeId: enrollment.nodeId,
      destinationId: enrollment.destinationId,
      runtimeVersion: enrollment.runtimeVersion,
      serviceManager: "launchd" as const,
      serviceIdentity: "com.lervo.node.multi-rollback",
      healthPath: resolve(root, "health.json"),
    },
    registry: {
      path: resolve(root, "registry.json"),
      reconciliation: "refresh" as const,
      current: {
        serviceInstanceId: enrollment.serviceInstanceId,
        projectId: project.projectId,
        repositoryIdentityHash: project.projectIdentityHash,
        repositoryRoot,
        nodeId: enrollment.nodeId,
        destinationId: enrollment.destinationId,
        runtimeVersion: "0.4.0",
        serviceManager: "launchd" as const,
        serviceIdentity: "com.lervo.node.multi-rollback",
        healthPath: resolve(root, "health.json"),
        registeredAt: "2026-08-27T00:09:00.000Z",
        updatedAt: "2026-08-27T00:09:00.000Z",
      },
    },
    service: {
      targetPath: resolve(root, "service.plist"),
      targetState: "present_unverified" as const,
      targetContentHash: organizationRolloutSha256(failedDefinition),
      legacyTargetPath: resolve(root, "legacy.plist"),
      legacyTargetState: "absent" as const,
      legacyTargetContentHash: null,
      activation: "not_observed" as const,
      readiness: "not_observed" as const,
    },
    actions: [],
    privacy: {
      scope: "local_plan_only" as const,
      absolutePaths: "local_output_only" as const,
      credentials: "excluded" as const,
      serviceDefinitionBodies: "excluded" as const,
    },
    staleIf: [
      "project_manifest_changes",
      "fleet_registry_changes",
      "service_target_changes",
      "legacy_service_target_changes",
      "desired_coordinates_change",
    ] as const,
  };
  const failedExecutablePath = resolve(root, "node-runtime-failed.js");
  const predecessorExecutablePath = resolve(root, "node-runtime-predecessor.js");
  return createInstalledOrganizationNodeRollbackPort(
    {
      registryPath: resolve(root, "registry.json"),
      repositoryRoot,
      nodeId: enrollment.nodeId,
      destinationId: enrollment.destinationId,
      serviceManager: "launchd",
      configPath: resolve(root, "node.json"),
      failedExecutablePath,
      predecessorExecutablePath,
    },
    {
      createPlan: async () => structuredClone(localPlan),
      loadConfig: async () => ({
        schemaVersion: 1,
        repositoryRoot,
        hub: {
          baseUrl: "https://hub.example.test/",
          bearerTokenFile: resolve(root, "token"),
          destinationId: enrollment.destinationId,
          hubIdentityHash: `sha256:${"d".repeat(64)}`,
        },
        sync: { workerId: "worker:rollback" },
        organizationCredentials: { nodeId: enrollment.nodeId },
      }),
      inspectExecutable: async (path) => ({
        path,
        artifactHash: path === failedExecutablePath ? targetArtifactHash : predecessorArtifactHash,
      }),
      renderDefinition: async () => failedDefinition,
      applyRollback: async ({ plan, failedRuntimeVersion }) => {
        rolledBack.push(enrollment.nodeId);
        return {
          schemaVersion: 1,
          operation: "repository_node_rollback",
          planId: plan.planId,
          failedRuntimeVersion,
          predecessorRuntimeVersion: enrollment.runtimeVersion,
          service: {
            change: "rolled_back",
            managerAvailable: true,
            installed: true,
            active: true,
            enabled: true,
            serviceIdentity: plan.desired.serviceIdentity,
          },
          readiness: {
            status: "ready",
            observations: 3,
            processId: 53,
            startedAt: "2026-08-27T00:13:00.000Z",
            sync: "ready",
            workstreamReplication: "ready",
            workspaceCoordination: "disabled",
            remoteControl: "ready",
          },
          registry: {
            change: "refreshed",
            registration: {
              ...plan.desired,
              registeredAt: "2026-08-27T00:03:00.000Z",
              updatedAt: "2026-08-27T00:13:00.000Z",
            },
          },
        };
      },
      now: () => new Date("2026-08-27T00:13:30.000Z"),
    },
  );
}

describe("installed organization multi-device rollout acceptance", () => {
  it("advances from one canary, holds incomplete expansion, and rolls back only the failed Node", async () => {
    const sourcePolicy = policy();
    const enrollments = await Promise.all(
      [1, 2, 3].map((index) => enrollNode(sourcePolicy, index)),
    );
    const rolloutPlan = createOrganizationFleetRolloutPlan({
      policy: sourcePolicy,
      enrollments,
      targetRuntimeVersion: "0.4.0",
      targetArtifactHash,
      waves: [
        [enrollments[0]!.enrollmentId],
        [enrollments[1]!.enrollmentId, enrollments[2]!.enrollmentId],
      ],
      plannedBy: "operator:deployment",
      plannedAt: "2026-08-27T00:04:00.000Z",
    });
    const applied: string[] = [];
    const forwardPorts = await Promise.all(
      enrollments.map((enrollment, index) => installedForwardPort(enrollment, index + 1, applied)),
    );
    const canaryApproval = createOrganizationFleetRolloutApproval({
      policy: sourcePolicy,
      plan: rolloutPlan,
      waveNumber: 1,
      action: "execute_wave",
      approvedBy: "operator:approval",
      approvedAt: "2026-08-27T00:05:00.000Z",
    });
    const canaryExecutionPlan = await createOrganizationNodeRolloutExecutionPlan({
      policy: sourcePolicy,
      rolloutPlan,
      approval: canaryApproval,
      enrollment: enrollments[0]!,
      executedBy: "operator:execution",
      plannedAt: "2026-08-27T00:06:00.000Z",
      port: forwardPorts[0]!,
    });
    const canaryReceipt = await applyOrganizationNodeRolloutExecution({
      executionPlan: canaryExecutionPlan,
      policy: sourcePolicy,
      rolloutPlan,
      approval: canaryApproval,
      enrollment: enrollments[0]!,
      executedAt: "2026-08-27T00:06:15.000Z",
      port: forwardPorts[0]!,
    });
    expect(canaryReceipt.effect).toEqual({ deployment: "executed", rollback: "not_executed" });

    const canaryObservation = createOrganizationFleetWaveObservation({
      policy: sourcePolicy,
      plan: rolloutPlan,
      enrollments,
      waveNumber: 1,
      nodes: [observedNode(enrollments[0]!)],
      observedBy: "operator:deployment",
      observedAt: "2026-08-27T00:07:00.000Z",
    });
    expect(
      evaluateOrganizationFleetWave({ plan: rolloutPlan, observation: canaryObservation }),
    ).toEqual({ state: "ready_to_advance", failures: [] });
    const expansionApproval = createOrganizationFleetRolloutApproval({
      policy: sourcePolicy,
      plan: rolloutPlan,
      waveNumber: 2,
      action: "execute_wave",
      observation: canaryObservation,
      approvedBy: "operator:approval",
      approvedAt: "2026-08-27T00:08:00.000Z",
    });
    const expansionPlans = await Promise.all(
      [1, 2].map((index) =>
        createOrganizationNodeRolloutExecutionPlan({
          policy: sourcePolicy,
          rolloutPlan,
          approval: expansionApproval,
          observation: canaryObservation,
          enrollment: enrollments[index]!,
          executedBy: "operator:execution",
          plannedAt: "2026-08-27T00:09:00.000Z",
          port: forwardPorts[index]!,
        }),
      ),
    );
    await Promise.all(
      [1, 2].map((index) =>
        applyOrganizationNodeRolloutExecution({
          executionPlan: expansionPlans[index - 1]!,
          policy: sourcePolicy,
          rolloutPlan,
          approval: expansionApproval,
          observation: canaryObservation,
          enrollment: enrollments[index]!,
          executedAt: "2026-08-27T00:09:15.000Z",
          port: forwardPorts[index]!,
        }),
      ),
    );

    const holdObservation = createOrganizationFleetWaveObservation({
      policy: sourcePolicy,
      plan: rolloutPlan,
      enrollments,
      waveNumber: 2,
      nodes: [observedNode(enrollments[2]!, "pending"), observedNode(enrollments[1]!)],
      observedBy: "operator:deployment",
      observedAt: "2026-08-27T00:10:00.000Z",
    });
    expect(
      evaluateOrganizationFleetWave({ plan: rolloutPlan, observation: holdObservation }),
    ).toEqual({ state: "hold", failures: ["readiness_incomplete"] });
    expect(() =>
      createOrganizationFleetRolloutApproval({
        policy: sourcePolicy,
        plan: rolloutPlan,
        waveNumber: 2,
        action: "rollback_wave",
        observation: holdObservation,
        approvedBy: "operator:approval",
        approvedAt: "2026-08-27T00:10:30.000Z",
      }),
    ).toThrowError(expect.objectContaining({ code: "fleet_wave_gate_not_satisfied" }));

    const failedNodes = [observedNode(enrollments[2]!, "degraded"), observedNode(enrollments[1]!)];
    const failedObservation = createOrganizationFleetWaveObservation({
      policy: sourcePolicy,
      plan: rolloutPlan,
      enrollments,
      waveNumber: 2,
      nodes: failedNodes,
      observedBy: "operator:deployment",
      observedAt: "2026-08-27T00:11:00.000Z",
    });
    const reorderedFailedObservation = createOrganizationFleetWaveObservation({
      policy: sourcePolicy,
      plan: rolloutPlan,
      enrollments,
      waveNumber: 2,
      nodes: [...failedNodes].reverse(),
      observedBy: "operator:deployment",
      observedAt: "2026-08-27T00:11:00.000Z",
    });
    expect(reorderedFailedObservation).toEqual(failedObservation);
    expect(
      evaluateOrganizationFleetWave({ plan: rolloutPlan, observation: failedObservation }),
    ).toEqual({ state: "rollback_required", failures: ["readiness_incomplete"] });
    const rollbackApproval = createOrganizationFleetRolloutApproval({
      policy: sourcePolicy,
      plan: rolloutPlan,
      waveNumber: 2,
      action: "rollback_wave",
      observation: failedObservation,
      approvedBy: "operator:approval",
      approvedAt: "2026-08-27T00:12:00.000Z",
    });
    const rolledBack: string[] = [];
    const rollbackPort = await installedRollbackPort(enrollments[2]!, rolledBack);
    await expect(
      createOrganizationNodeRolloutRollbackPlan({
        policy: sourcePolicy,
        rolloutPlan,
        approval: rollbackApproval,
        observation: failedObservation,
        enrollment: enrollments[1]!,
        rolledBackBy: "operator:execution",
        plannedAt: "2026-08-27T00:13:00.000Z",
        port: rollbackPort,
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: "invalid_node_rollout_rollback_plan" }));
    const rollbackPlan = await createOrganizationNodeRolloutRollbackPlan({
      policy: sourcePolicy,
      rolloutPlan,
      approval: rollbackApproval,
      observation: failedObservation,
      enrollment: enrollments[2]!,
      rolledBackBy: "operator:execution",
      plannedAt: "2026-08-27T00:13:00.000Z",
      port: rollbackPort,
    });
    const rollbackReceipt = await applyOrganizationNodeRolloutRollback({
      rollbackPlan,
      policy: sourcePolicy,
      rolloutPlan,
      approval: rollbackApproval,
      observation: failedObservation,
      enrollment: enrollments[2]!,
      rolledBackAt: "2026-08-27T00:13:15.000Z",
      port: rollbackPort,
    });

    expect(applied.sort()).toEqual(enrollments.map((enrollment) => enrollment.nodeId).sort());
    expect(rolledBack).toEqual([enrollments[2]!.nodeId]);
    expect(rollbackReceipt).toMatchObject({
      enrollmentId: enrollments[2]!.enrollmentId,
      predecessorRuntimeVersion: "0.3.1",
      predecessorArtifactHash,
      effect: { deployment: "not_executed", rollback: "executed" },
      secretMaterial: "excluded",
    });
  });
});
