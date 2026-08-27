import { createHash } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type {
  OrganizationNodeEnrollment,
  OrganizationNodeRolloutExecutionPlan,
  OrganizationNodeRolloutRollbackPlan,
} from "@lervo/schemas";
import { afterEach, describe, expect, it } from "vitest";

import { createInstalledOrganizationNodeRollbackPort } from "../src/organization-node-rollback.js";
import { createInstalledOrganizationNodeRolloutPort } from "../src/organization-node-rollout.js";

const temporaryDirectories: string[] = [];
const projectId = "prj_organization01";
const projectIdentityHash = `sha256:${"a".repeat(64)}`;
const targetArtifactHash = `sha256:${"c".repeat(64)}`;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function enrollment(): OrganizationNodeEnrollment {
  return {
    schemaVersion: 1,
    enrollmentId: `one_${"1".repeat(64)}`,
    organizationId: "org_example01",
    policyId: `odp_${"2".repeat(64)}`,
    policyHash: `sha256:${"3".repeat(64)}`,
    target: { projectId, projectIdentityHash },
    nodeId: "node_organization01",
    destinationId: "hub:organization:1",
    serviceInstanceId: `nfi_${"4".repeat(24)}`,
    runtimeVersion: "0.3.1",
    runtimeArtifactHash: `sha256:${"5".repeat(64)}`,
    credentialId: `ocg_${"6".repeat(64)}`,
    credentialDeliveryId: `ocd_${"7".repeat(64)}`,
    localPlanId: `nfp_${"8".repeat(24)}`,
    localApplyReceiptHash: `sha256:${"9".repeat(64)}`,
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
    secretMaterial: "excluded",
  };
}

describe("installed organization Node rollout composition", () => {
  it("binds exact executable and config coordinates to the existing local apply receipt", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-org-rollout-"));
    temporaryDirectories.push(root);
    const physicalRoot = await realpath(root);
    const sourceEnrollment = enrollment();
    const localPlan = {
      schemaVersion: 1 as const,
      planKind: "repository_node_onboarding" as const,
      planId: `nfp_${"a".repeat(24)}`,
      outcome: "reconcile_required" as const,
      verification: "manifest_revalidated" as const,
      desired: {
        serviceInstanceId: `nfi_${"4".repeat(24)}`,
        projectId,
        repositoryIdentityHash: projectIdentityHash,
        repositoryRoot: physicalRoot,
        nodeId: sourceEnrollment.nodeId,
        destinationId: sourceEnrollment.destinationId,
        runtimeVersion: "0.4.0",
        serviceManager: "launchd" as const,
        serviceIdentity: "com.lervo.node.test",
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
    let applyCalls = 0;
    let readinessStatus: "ready" | "offline_ready" = "ready";
    const port = createInstalledOrganizationNodeRolloutPort(
      {
        registryPath: resolve(root, "registry.json"),
        repositoryRoot: physicalRoot,
        nodeId: sourceEnrollment.nodeId,
        destinationId: sourceEnrollment.destinationId,
        serviceManager: "launchd",
        configPath: resolve(root, "node.json"),
        executablePath: resolve(root, "node-runtime.js"),
      },
      {
        createPlan: async () => structuredClone(localPlan),
        loadConfig: async () => ({
          schemaVersion: 1,
          repositoryRoot: physicalRoot,
          hub: {
            baseUrl: "https://hub.example.test/",
            bearerTokenFile: resolve(root, "token"),
            destinationId: sourceEnrollment.destinationId,
            hubIdentityHash: `sha256:${"b".repeat(64)}`,
          },
          sync: { workerId: "worker:test" },
          organizationCredentials: { nodeId: sourceEnrollment.nodeId },
        }),
        inspectExecutable: async () => ({
          path: resolve(root, "node-runtime.js"),
          artifactHash: targetArtifactHash,
        }),
        applyPlan: async ({ plan }) => {
          applyCalls += 1;
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
              status: readinessStatus,
              observations: 3,
              processId: 42,
              startedAt: "2026-08-27T00:06:00.000Z",
              sync: "ready",
              workstreamReplication: "ready",
              workspaceCoordination: "disabled",
              remoteControl: "ready",
            },
            registry: {
              change: "refreshed",
              registration: {
                ...plan.desired,
                registeredAt: "2026-08-27T00:06:00.000Z",
                updatedAt: "2026-08-27T00:06:00.000Z",
              },
            },
          };
        },
        now: () => new Date("2026-08-27T00:06:30.000Z"),
      },
    );
    const planned = await port.plan({
      enrollment: sourceEnrollment,
      targetRuntimeVersion: "0.4.0",
      targetArtifactHash,
    });
    const executionPlan: OrganizationNodeRolloutExecutionPlan = {
      schemaVersion: 1,
      executionPlanId: `oxp_${"d".repeat(64)}`,
      organizationId: sourceEnrollment.organizationId,
      policyId: sourceEnrollment.policyId,
      rolloutPlanId: `orp_${"e".repeat(64)}`,
      rolloutPlanHash: `sha256:${"f".repeat(64)}`,
      approvalId: `ofa_${"1".repeat(64)}`,
      approvalHash: `sha256:${"2".repeat(64)}`,
      waveNumber: 1,
      action: "execute_wave",
      target: sourceEnrollment.target,
      enrollmentId: sourceEnrollment.enrollmentId,
      nodeId: sourceEnrollment.nodeId,
      destinationId: sourceEnrollment.destinationId,
      targetRuntimeVersion: "0.4.0",
      targetArtifactHash,
      localPlanId: planned.localPlanId,
      localPlanHash: planned.localPlanHash,
      executedBy: "operator:execution",
      plannedAt: "2026-08-27T00:06:00.000Z",
      effect: { deployment: "not_executed", rollback: "not_executed" },
      secretMaterial: "excluded",
    };
    await expect(
      port.apply({ executionPlan, enrollment: sourceEnrollment }),
    ).resolves.toMatchObject({
      localPlanId: localPlan.planId,
      localApplyReceiptHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      completedAt: "2026-08-27T00:06:30.000Z",
      effect: "applied",
    });
    expect(applyCalls).toBe(1);

    readinessStatus = "offline_ready";
    await expect(port.apply({ executionPlan, enrollment: sourceEnrollment })).rejects.toThrow(
      "does not prove online readiness",
    );
    expect(applyCalls).toBe(2);

    await expect(
      port.plan({
        enrollment: sourceEnrollment,
        targetRuntimeVersion: "0.4.0",
        targetArtifactHash: `sha256:${"0".repeat(64)}`,
      }),
    ).rejects.toThrow("does not match the organization rollout target");
  });

  it("applies only the exact failed service to the enrolled predecessor through rollback", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-org-rollback-"));
    temporaryDirectories.push(root);
    const physicalRoot = await realpath(root);
    const sourceEnrollment = enrollment();
    const failedExecutablePath = resolve(root, "node-runtime-failed.js");
    const predecessorExecutablePath = resolve(root, "node-runtime-predecessor.js");
    const configPath = resolve(root, "node.json");
    const failedDefinition = "failed-service-definition";
    const failedDefinitionHash = `sha256:${createHash("sha256")
      .update(failedDefinition)
      .digest("hex")}`;
    const localPlan = {
      schemaVersion: 1 as const,
      planKind: "repository_node_onboarding" as const,
      planId: `nfp_${"b".repeat(24)}`,
      outcome: "reconcile_required" as const,
      verification: "manifest_revalidated" as const,
      desired: {
        serviceInstanceId: sourceEnrollment.serviceInstanceId,
        projectId,
        repositoryIdentityHash: projectIdentityHash,
        repositoryRoot: physicalRoot,
        nodeId: sourceEnrollment.nodeId,
        destinationId: sourceEnrollment.destinationId,
        runtimeVersion: sourceEnrollment.runtimeVersion,
        serviceManager: "launchd" as const,
        serviceIdentity: "com.lervo.node.test",
        healthPath: resolve(root, "health.json"),
      },
      registry: {
        path: resolve(root, "registry.json"),
        reconciliation: "refresh" as const,
        current: {
          serviceInstanceId: sourceEnrollment.serviceInstanceId,
          projectId,
          repositoryIdentityHash: projectIdentityHash,
          repositoryRoot: physicalRoot,
          nodeId: sourceEnrollment.nodeId,
          destinationId: sourceEnrollment.destinationId,
          runtimeVersion: "0.4.0",
          serviceManager: "launchd" as const,
          serviceIdentity: "com.lervo.node.test",
          healthPath: resolve(root, "health.json"),
          registeredAt: "2026-08-27T00:03:00.000Z",
          updatedAt: "2026-08-27T00:06:00.000Z",
        },
      },
      service: {
        targetPath: resolve(root, "service.plist"),
        targetState: "present_unverified" as const,
        targetContentHash: failedDefinitionHash,
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
    let rollbackCalls = 0;
    const port = createInstalledOrganizationNodeRollbackPort(
      {
        registryPath: resolve(root, "registry.json"),
        repositoryRoot: physicalRoot,
        nodeId: sourceEnrollment.nodeId,
        destinationId: sourceEnrollment.destinationId,
        serviceManager: "launchd",
        configPath,
        failedExecutablePath,
        predecessorExecutablePath,
      },
      {
        createPlan: async () => structuredClone(localPlan),
        loadConfig: async () => ({
          schemaVersion: 1,
          repositoryRoot: physicalRoot,
          hub: {
            baseUrl: "https://hub.example.test/",
            bearerTokenFile: resolve(root, "token"),
            destinationId: sourceEnrollment.destinationId,
            hubIdentityHash: `sha256:${"b".repeat(64)}`,
          },
          sync: { workerId: "worker:test" },
          organizationCredentials: { nodeId: sourceEnrollment.nodeId },
        }),
        inspectExecutable: async (path) => ({
          path,
          artifactHash:
            path === failedExecutablePath
              ? targetArtifactHash
              : sourceEnrollment.runtimeArtifactHash,
        }),
        renderDefinition: async () => failedDefinition,
        applyRollback: async ({ plan, failedRuntimeVersion }) => {
          rollbackCalls += 1;
          return {
            schemaVersion: 1,
            operation: "repository_node_rollback",
            planId: plan.planId,
            failedRuntimeVersion,
            predecessorRuntimeVersion: sourceEnrollment.runtimeVersion,
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
              processId: 43,
              startedAt: "2026-08-27T00:08:00.000Z",
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
                updatedAt: "2026-08-27T00:08:00.000Z",
              },
            },
          };
        },
        now: () => new Date("2026-08-27T00:08:30.000Z"),
      },
    );
    const planned = await port.plan({
      enrollment: sourceEnrollment,
      failedRuntimeVersion: "0.4.0",
      failedArtifactHash: targetArtifactHash,
      predecessorRuntimeVersion: sourceEnrollment.runtimeVersion,
      predecessorArtifactHash: sourceEnrollment.runtimeArtifactHash,
    });
    const rollbackPlan: OrganizationNodeRolloutRollbackPlan = {
      schemaVersion: 1,
      rollbackPlanId: `orb_${"c".repeat(64)}`,
      organizationId: sourceEnrollment.organizationId,
      policyId: sourceEnrollment.policyId,
      rolloutPlanId: `orp_${"d".repeat(64)}`,
      rolloutPlanHash: `sha256:${"e".repeat(64)}`,
      approvalId: `ofa_${"f".repeat(64)}`,
      approvalHash: `sha256:${"1".repeat(64)}`,
      evidenceObservationId: `ofw_${"2".repeat(64)}`,
      evidenceObservationHash: `sha256:${"3".repeat(64)}`,
      waveNumber: 1,
      action: "rollback_wave",
      target: sourceEnrollment.target,
      enrollmentId: sourceEnrollment.enrollmentId,
      nodeId: sourceEnrollment.nodeId,
      destinationId: sourceEnrollment.destinationId,
      failedRuntimeVersion: "0.4.0",
      failedArtifactHash: targetArtifactHash,
      predecessorRuntimeVersion: sourceEnrollment.runtimeVersion,
      predecessorArtifactHash: sourceEnrollment.runtimeArtifactHash,
      localPlanId: planned.localPlanId,
      localPlanHash: planned.localPlanHash,
      rolledBackBy: "operator:rollback",
      plannedAt: "2026-08-27T00:08:00.000Z",
      effect: { deployment: "not_executed", rollback: "not_executed" },
      secretMaterial: "excluded",
    };
    await expect(
      port.rollback({ rollbackPlan, enrollment: sourceEnrollment }),
    ).resolves.toMatchObject({
      predecessorRuntimeVersion: sourceEnrollment.runtimeVersion,
      predecessorArtifactHash: sourceEnrollment.runtimeArtifactHash,
      effect: "rolled_back",
      completedAt: "2026-08-27T00:08:30.000Z",
    });
    expect(rollbackCalls).toBe(1);

    await expect(
      port.plan({
        enrollment: sourceEnrollment,
        failedRuntimeVersion: "0.4.0",
        failedArtifactHash: targetArtifactHash,
        predecessorRuntimeVersion: sourceEnrollment.runtimeVersion,
        predecessorArtifactHash: `sha256:${"0".repeat(64)}`,
      }),
    ).rejects.toThrow("does not match this installed Node enrollment");
    expect(rollbackCalls).toBe(1);
  });
});
