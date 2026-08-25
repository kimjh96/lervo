import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan, loadProjectManifest } from "@lervo/project";
import { calculateProjectIdentityHash } from "@lervo/sync-contract";
import { describe, expect, it } from "vitest";

import {
  calculateNodeFleetServiceInstanceId,
  createNodeFleetOnboardingPlan,
  listNodeFleetInstances,
  nodeFleetServiceIdentity,
  registerNodeFleetInstance,
  validateNodeFleetRegistry,
} from "../src/index.js";

async function hubRepository(parent: string, name: string, projectId: string): Promise<string> {
  const root = resolve(parent, name);
  await mkdir(root);
  await applyInitPlan(
    await createInitPlan({
      root,
      name,
      projectId,
      now: new Date("2026-08-25T00:00:00.000Z"),
    }),
  );
  const manifestPath = resolve(root, ".lervo/project.yaml");
  const source = await readFile(manifestPath, "utf8");
  await writeFile(manifestPath, source.replace("hubSyncEnabled: false", "hubSyncEnabled: true"));
  return root;
}

describe("repository Node fleet registry", () => {
  it("plans first onboarding without writing registry, service, credential, or readiness state", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-node-fleet-plan-"));
    const repository = await hubRepository(root, "alpha", "prj_abcdefgh12345678");
    const registry = resolve(root, "state/node-fleet.json");
    const plan = await createNodeFleetOnboardingPlan({
      registryPath: registry,
      repositoryRoot: repository,
      nodeId: "node_alpha_device_01",
      destinationId: "hub:alpha",
      runtimeVersion: "0.1.0",
      serviceManager: "launchd",
      homeDirectory: resolve(root, "home"),
    });
    expect(plan).toMatchObject({
      planKind: "repository_node_onboarding",
      outcome: "reconcile_required",
      verification: "manifest_revalidated",
      registry: { reconciliation: "register", current: null },
      service: {
        targetState: "absent",
        legacyTargetState: "absent",
        activation: "not_observed",
        readiness: "not_observed",
      },
      privacy: { credentials: "excluded", serviceDefinitionBodies: "excluded" },
    });
    expect(plan.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "register_fleet_instance",
          state: "required",
          authority: "local_state_write",
        }),
        expect.objectContaining({
          code: "issue_scoped_credentials",
          state: "unobserved",
          authority: "external_registration",
        }),
        expect.objectContaining({ code: "observe_runtime_readiness", state: "unobserved" }),
      ]),
    );
    await expect(readFile(registry)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("distinguishes unchanged desired coordinates from a stale registry", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-node-fleet-plan-"));
    const repository = await hubRepository(root, "alpha", "prj_abcdefgh12345678");
    const registry = resolve(root, "state/node-fleet.json");
    const registration = await registerNodeFleetInstance({
      registryPath: registry,
      repositoryRoot: repository,
      nodeId: "node_alpha_device_01",
      destinationId: "hub:alpha",
      runtimeVersion: "0.1.0",
      serviceManager: "systemd",
    });
    const home = resolve(root, "home");
    const target = resolve(home, ".config/systemd/user", registration.registration.serviceIdentity);
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, "verified later\n");
    await chmod(target, 0o600);
    const unchanged = await createNodeFleetOnboardingPlan({
      registryPath: registry,
      repositoryRoot: repository,
      nodeId: "node_alpha_device_01",
      destinationId: "hub:alpha",
      runtimeVersion: "0.1.0",
      serviceManager: "systemd",
      homeDirectory: home,
    });
    expect(unchanged).toMatchObject({
      outcome: "observation_required",
      registry: { reconciliation: "unchanged" },
      service: { targetState: "present_unverified", readiness: "not_observed" },
    });
    const stale = await createNodeFleetOnboardingPlan({
      registryPath: registry,
      repositoryRoot: repository,
      nodeId: "node_alpha_device_01",
      destinationId: "hub:alpha-v2",
      runtimeVersion: "0.2.0",
      serviceManager: "systemd",
      homeDirectory: home,
    });
    expect(stale).toMatchObject({
      outcome: "reconcile_required",
      registry: { reconciliation: "refresh" },
    });
    expect(stale.actions).toContainEqual(
      expect.objectContaining({ code: "refresh_fleet_instance", state: "required" }),
    );
  });

  it("reports a legacy singleton as an authority-gated transition without changing it", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-node-fleet-plan-"));
    const repository = await hubRepository(root, "alpha", "prj_abcdefgh12345678");
    const home = resolve(root, "home");
    const legacy = resolve(home, "Library/LaunchAgents/com.lervo.node.plist");
    await mkdir(resolve(legacy, ".."), { recursive: true });
    await writeFile(legacy, "legacy\n");
    await chmod(legacy, 0o600);
    const plan = await createNodeFleetOnboardingPlan({
      registryPath: resolve(root, "state/node-fleet.json"),
      repositoryRoot: repository,
      nodeId: "node_alpha_device_01",
      destinationId: "hub:alpha",
      runtimeVersion: "0.1.0",
      serviceManager: "launchd",
      homeDirectory: home,
    });
    expect(plan.service.legacyTargetState).toBe("present_unverified");
    expect(plan.actions).toContainEqual(
      expect.objectContaining({
        code: "review_legacy_singleton",
        state: "required",
        authority: "service_transition",
      }),
    );
    expect(await readFile(legacy, "utf8")).toBe("legacy\n");
  });

  it("derives independent plans for two repositories on one device", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-node-fleet-plan-"));
    const alpha = await hubRepository(root, "alpha", "prj_abcdefgh12345678");
    const beta = await hubRepository(root, "beta", "prj_bcdefghi12345678");
    const common = {
      registryPath: resolve(root, "state/node-fleet.json"),
      runtimeVersion: "0.1.0",
      serviceManager: "launchd" as const,
      homeDirectory: resolve(root, "home"),
    };
    const [first, second] = await Promise.all([
      createNodeFleetOnboardingPlan({
        ...common,
        repositoryRoot: alpha,
        nodeId: "node_alpha_device_01",
        destinationId: "hub:alpha",
      }),
      createNodeFleetOnboardingPlan({
        ...common,
        repositoryRoot: beta,
        nodeId: "node_beta_device_001",
        destinationId: "hub:beta",
      }),
    ]);
    expect(first.desired.serviceInstanceId).not.toBe(second.desired.serviceInstanceId);
    expect(first.service.targetPath).not.toBe(second.service.targetPath);
    expect(first.planId).not.toBe(second.planId);
  });

  it("persists two independently addressable repository Nodes without credential bytes", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-node-fleet-"));
    const alpha = await hubRepository(root, "alpha", "prj_abcdefgh12345678");
    const beta = await hubRepository(root, "beta", "prj_bcdefghi12345678");
    const registry = resolve(root, "state/node-fleet.json");
    const first = await registerNodeFleetInstance({
      registryPath: registry,
      repositoryRoot: alpha,
      nodeId: "node_alpha_device_01",
      destinationId: "hub:alpha",
      runtimeVersion: "0.1.0",
      serviceManager: "launchd",
      now: new Date("2026-08-25T01:00:00.000Z"),
    });
    const second = await registerNodeFleetInstance({
      registryPath: registry,
      repositoryRoot: beta,
      nodeId: "node_beta_device_001",
      destinationId: "hub:beta",
      runtimeVersion: "0.1.0",
      serviceManager: "launchd",
      now: new Date("2026-08-25T01:01:00.000Z"),
    });
    expect(first.change).toBe("registered");
    expect(second.change).toBe("registered");
    expect(first.registration.serviceIdentity).not.toBe(second.registration.serviceIdentity);
    expect(first.registration.healthPath).toBe(
      resolve(first.registration.repositoryRoot, ".lervo/state/node-runtime-health.json"),
    );
    expect((await listNodeFleetInstances(registry)).map((entry) => entry.projectId)).toEqual([
      "prj_abcdefgh12345678",
      "prj_bcdefghi12345678",
    ]);
    const serialized = await readFile(registry, "utf8");
    expect(serialized).not.toContain("bearerToken");
    expect(serialized).not.toContain("credential");
    expect((await stat(resolve(root, "state"))).mode & 0o077).toBe(0);
    expect((await stat(registry)).mode & 0o077).toBe(0);
  });

  it("derives a stable service instance from manifest and node identity, never the folder name", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-node-fleet-"));
    const repository = await hubRepository(root, "renamable-folder", "prj_abcdefgh12345678");
    const manifest = await loadProjectManifest(repository);
    const input = {
      projectId: manifest.projectId,
      repositoryIdentityHash: calculateProjectIdentityHash(manifest),
      nodeId: "node_alpha_device_01",
    };
    const instance = calculateNodeFleetServiceInstanceId(input);
    expect(instance).toMatch(/^nfi_[a-f0-9]{24}$/u);
    expect(calculateNodeFleetServiceInstanceId({ ...input })).toBe(instance);
    expect(nodeFleetServiceIdentity("systemd", instance)).toBe(
      `lervo-node-${instance.slice(4)}.service`,
    );
    expect(nodeFleetServiceIdentity("launchd", instance)).toBe(
      `com.lervo.node.${instance.slice(4)}`,
    );
  });

  it("refreshes mutable deployment coordinates while retaining instance identity and first registration", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-node-fleet-"));
    const repository = await hubRepository(root, "alpha", "prj_abcdefgh12345678");
    const registry = resolve(root, "state/node-fleet.json");
    const first = await registerNodeFleetInstance({
      registryPath: registry,
      repositoryRoot: repository,
      nodeId: "node_alpha_device_01",
      destinationId: "hub:alpha",
      runtimeVersion: "0.1.0",
      serviceManager: "systemd",
      now: new Date("2026-08-25T01:00:00.000Z"),
    });
    await expect(
      registerNodeFleetInstance({
        registryPath: registry,
        repositoryRoot: repository,
        nodeId: "node_alpha_device_01",
        destinationId: "hub:alpha",
        runtimeVersion: "0.1.0",
        serviceManager: "systemd",
        now: new Date("2026-08-25T01:01:00.000Z"),
      }),
    ).resolves.toMatchObject({ change: "unchanged" });
    const refreshed = await registerNodeFleetInstance({
      registryPath: registry,
      repositoryRoot: repository,
      nodeId: "node_alpha_device_01",
      destinationId: "hub:alpha-v2",
      runtimeVersion: "0.2.0",
      serviceManager: "systemd",
      now: new Date("2026-08-25T01:02:00.000Z"),
    });
    expect(refreshed).toMatchObject({
      change: "refreshed",
      registration: {
        serviceInstanceId: first.registration.serviceInstanceId,
        registeredAt: "2026-08-25T01:00:00.000Z",
        updatedAt: "2026-08-25T01:02:00.000Z",
        destinationId: "hub:alpha-v2",
        runtimeVersion: "0.2.0",
      },
    });
  });

  it("fails closed on duplicate node coordinates and unrecognized secret-shaped fields", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-node-fleet-"));
    const alpha = await hubRepository(root, "alpha", "prj_abcdefgh12345678");
    const beta = await hubRepository(root, "beta", "prj_bcdefghi12345678");
    const registry = resolve(root, "state/node-fleet.json");
    const registered = await registerNodeFleetInstance({
      registryPath: registry,
      repositoryRoot: alpha,
      nodeId: "node_shared_device_01",
      destinationId: "hub:alpha",
      runtimeVersion: "0.1.0",
      serviceManager: "launchd",
    });
    await expect(
      registerNodeFleetInstance({
        registryPath: registry,
        repositoryRoot: beta,
        nodeId: "node_shared_device_01",
        destinationId: "hub:beta",
        runtimeVersion: "0.1.0",
        serviceManager: "launchd",
      }),
    ).rejects.toMatchObject({ code: "node_fleet_node_conflict" });
    expect(() =>
      validateNodeFleetRegistry({
        schemaVersion: 1,
        kind: "lervo_node_fleet_registry",
        instances: [{ ...registered.registration, bearerToken: "secret" }],
      }),
    ).toThrow();
  });
});
