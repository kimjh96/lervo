import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type { NodeFleetOnboardingPlan } from "@lervo/repository-registry";
import { afterEach, describe, expect, it } from "vitest";

import { applyNodeFleetRollback } from "../src/node-fleet-rollback.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("repository Node local rollback", () => {
  it("uses the explicit service rollback action and commits the predecessor only after readiness", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-node-rollback-"));
    roots.push(root);
    const failedDefinition = "failed-service-definition";
    const predecessorDefinition = "predecessor-service-definition";
    const failedHash = `sha256:${createHash("sha256").update(failedDefinition).digest("hex")}`;
    const plan: NodeFleetOnboardingPlan = {
      schemaVersion: 1,
      planKind: "repository_node_onboarding",
      planId: `nfp_${"a".repeat(24)}`,
      outcome: "reconcile_required",
      verification: "manifest_revalidated",
      desired: {
        serviceInstanceId: `nfi_${"b".repeat(24)}`,
        projectId: "prj_organization01",
        repositoryIdentityHash: `sha256:${"c".repeat(64)}`,
        repositoryRoot: root,
        nodeId: "node_organization01",
        destinationId: "hub:organization:1",
        runtimeVersion: "0.3.1",
        serviceManager: "launchd",
        serviceIdentity: "com.lervo.node.test",
        healthPath: resolve(root, "health.json"),
      },
      registry: {
        path: resolve(root, "registry.json"),
        reconciliation: "refresh",
        current: {
          serviceInstanceId: `nfi_${"b".repeat(24)}`,
          projectId: "prj_organization01",
          repositoryIdentityHash: `sha256:${"c".repeat(64)}`,
          repositoryRoot: root,
          nodeId: "node_organization01",
          destinationId: "hub:organization:1",
          runtimeVersion: "0.4.0",
          serviceManager: "launchd",
          serviceIdentity: "com.lervo.node.test",
          healthPath: resolve(root, "health.json"),
          registeredAt: "2026-08-27T00:00:00.000Z",
          updatedAt: "2026-08-27T00:01:00.000Z",
        },
      },
      service: {
        targetPath: resolve(root, "service.plist"),
        targetState: "present_unverified",
        targetContentHash: failedHash,
        legacyTargetPath: resolve(root, "legacy.plist"),
        legacyTargetState: "absent",
        legacyTargetContentHash: null,
        activation: "not_observed",
        readiness: "not_observed",
      },
      actions: [],
      privacy: {
        scope: "local_plan_only",
        absolutePaths: "local_output_only",
        credentials: "excluded",
        serviceDefinitionBodies: "excluded",
      },
      staleIf: [
        "project_manifest_changes",
        "fleet_registry_changes",
        "service_target_changes",
        "legacy_service_target_changes",
        "desired_coordinates_change",
      ],
    };
    const actions: string[] = [];
    let readinessObserved = false;
    let registryCommitted = false;
    const receipt = await applyNodeFleetRollback({
      plan,
      failedRuntimeVersion: "0.4.0",
      configPath: resolve(root, "node.json"),
      failedExecutablePath: resolve(root, "failed.js"),
      predecessorExecutablePath: resolve(root, "predecessor.js"),
      now: () => new Date("2026-08-27T00:02:00.000Z"),
      ports: {
        createPlan: async () => structuredClone(plan),
        inspectExecutable: async (path) => path,
        renderDefinition: async ({ executable }) =>
          executable.endsWith("failed.js") ? failedDefinition : predecessorDefinition,
        manageService: async (args) => {
          actions.push(args[args.indexOf("--action") + 1]!);
          return {
            change: "rolled_back",
            managerAvailable: true,
            installed: true,
            active: true,
            enabled: true,
            serviceIdentity: plan.desired.serviceIdentity,
          };
        },
        observeReadiness: async () => {
          readinessObserved = true;
          return {
            status: "ready",
            observations: 3,
            processId: 42,
            startedAt: "2026-08-27T00:02:00.000Z",
            sync: "ready",
            workstreamReplication: "ready",
            workspaceCoordination: "disabled",
            remoteControl: "ready",
            conversation: "disabled",
            supervision: "disabled",
            baseline: "unavailable",
            carriedConditions: [],
          };
        },
        register: async () => {
          expect(readinessObserved).toBe(true);
          registryCommitted = true;
          return {
            change: "refreshed",
            registration: {
              ...plan.desired,
              registeredAt: "2026-08-27T00:00:00.000Z",
              updatedAt: "2026-08-27T00:02:00.000Z",
            },
          };
        },
      },
    });
    expect(actions).toEqual(["rollback"]);
    expect(registryCommitted).toBe(true);
    expect(receipt).toMatchObject({
      operation: "repository_node_rollback",
      failedRuntimeVersion: "0.4.0",
      predecessorRuntimeVersion: "0.3.1",
      service: { change: "rolled_back" },
      readiness: { status: "ready" },
    });
  });
});
