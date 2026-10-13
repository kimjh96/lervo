import { chmod, mkdir, mkdtemp, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../src/main.js";
import { applyNodeFleetOnboarding } from "../src/node-fleet-apply.js";
import {
  createNodeFleetOnboardingPlan,
  listNodeFleetInstances,
  listRegisteredRepositories,
} from "@lervo/repository-registry";

function io(cwd: string, stdout: string[], stderr: string[]) {
  return {
    cwd,
    stdout: (message: string) => stdout.push(message),
    stderr: (message: string) => stderr.push(message),
  };
}

describe("repository selection command", () => {
  it("registers a ready Node and preserves the service fence during upgrade", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-cli-repository-node-apply-"));
    const repository = resolve(root, "repository");
    const home = resolve(root, "home");
    const registry = resolve(root, "state/node-fleet.json");
    await mkdir(repository);
    expect(
      await runCli(["init", "--root", repository, "--name", "fixture"], io(root, [], [])),
    ).toBe(0);
    const manifestPath = resolve(repository, ".lervo/project.yaml");
    await writeFile(
      manifestPath,
      (await readFile(manifestPath, "utf8")).replace(
        "hubSyncEnabled: false",
        "hubSyncEnabled: true",
      ),
    );
    const token = resolve(root, "node.token");
    const trust = resolve(root, "remote-trust.json");
    const config = resolve(root, "node-runtime.json");
    const executable = resolve(root, "lervo-node");
    await writeFile(token, "fixture-token\n", { mode: 0o600 });
    await writeFile(trust, "{}\n", { mode: 0o600 });
    await writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    await chmod(executable, 0o755);
    await writeFile(
      config,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          repositoryRoot: repository,
          hub: {
            baseUrl: "https://hub.example.test/",
            bearerTokenFile: token,
            destinationId: "hub:fixture",
            hubIdentityHash: `sha256:${"a".repeat(64)}`,
          },
          sync: { workerId: "node:fixture" },
          remoteCommands: { nodeId: "node_fixture_device_01", trustFile: trust },
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    await chmod(config, 0o600);
    const plan = await createNodeFleetOnboardingPlan({
      registryPath: registry,
      repositoryRoot: repository,
      nodeId: "node_fixture_device_01",
      destinationId: "hub:fixture",
      runtimeVersion: "0.1.0",
      serviceManager: "launchd",
      homeDirectory: home,
    });
    let active = false;
    let readinessReads = 0;
    const runtimeStartedAt = new Date(Date.now() + 1_000).toISOString();
    const receipt = await applyNodeFleetOnboarding({
      plan,
      configPath: config,
      homeDirectory: home,
      ports: {
        executablePath: executable,
        serviceOptions: {
          platform: "darwin",
          uid: 501,
          homeDirectory: home,
          wait: async () => undefined,
          runCommand: async (_command, args) => {
            if (args[0] === "bootstrap") active = true;
            if (args[0] === "bootout") active = false;
            return { exitCode: args[0] === "print" ? (active ? 0 : 1) : 0 };
          },
        },
        wait: async () => undefined,
        readHealth: async () => {
          readinessReads += 1;
          const now = new Date(Date.now() + readinessReads * 1_000).toISOString();
          return {
            schemaVersion: 1,
            status: "ready",
            processId: 1234,
            startedAt: runtimeStartedAt,
            updatedAt: now,
            sync: { status: "ready" },
            workstreamReplication: { status: "ready" },
            workspaceCoordination: { status: "disabled" },
            remoteControl: { status: "ready" },
          };
        },
      },
    });
    expect(receipt).toMatchObject({
      service: { change: "installed", active: true },
      readiness: { observations: 3 },
      registry: { change: "registered" },
    });
    expect(readinessReads).toBe(3);
    expect(await listNodeFleetInstances(registry)).toHaveLength(1);
    // The Node's checkout also joins the host repository registry beside the fleet registry.
    expect(
      (await listRegisteredRepositories(resolve(root, "state/repositories.json"))).map(
        (entry) => entry.projectId,
      ),
    ).toEqual([(await listNodeFleetInstances(registry))[0]!.projectId]);
    expect((await stat(plan.service.targetPath)).mode & 0o077).toBe(0);

    const originalDefinition = await readFile(plan.service.targetPath);
    const replacementExecutable = resolve(root, "lervo-node-next");
    await writeFile(replacementExecutable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const replacementPlan = await createNodeFleetOnboardingPlan({
      registryPath: registry,
      repositoryRoot: repository,
      nodeId: "node_fixture_device_01",
      destinationId: "hub:fixture",
      runtimeVersion: "0.2.0",
      serviceManager: "launchd",
      homeDirectory: home,
    });
    await expect(
      applyNodeFleetOnboarding({
        plan: replacementPlan,
        configPath: config,
        homeDirectory: home,
        ports: {
          executablePath: replacementExecutable,
          serviceOptions: {
            platform: "darwin",
            uid: 501,
            homeDirectory: home,
            runCommand: async (_command, args) => ({
              exitCode: args[0] === "print" ? (active ? 0 : 1) : 0,
            }),
          },
        },
      }),
    ).rejects.toMatchObject({ code: "service_upgrade_fence_invalid" });
    expect(await readFile(plan.service.targetPath)).toEqual(originalDefinition);
    expect((await listNodeFleetInstances(registry))[0]?.runtimeVersion).toBe("0.1.0");
  });

  it("exposes a read-only repository Node onboarding plan", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-cli-repository-node-"));
    const repository = resolve(root, "repository");
    await mkdir(repository);
    expect(
      await runCli(["init", "--root", repository, "--name", "fixture"], io(root, [], [])),
    ).toBe(0);
    const manifestPath = resolve(repository, ".lervo/project.yaml");
    await writeFile(
      manifestPath,
      (await readFile(manifestPath, "utf8")).replace(
        "hubSyncEnabled: false",
        "hubSyncEnabled: true",
      ),
    );
    const output: string[] = [];
    expect(
      await runCli(
        [
          "repository",
          "node",
          "plan",
          "--root",
          repository,
          "--node",
          "node_fixture_device_01",
          "--destination",
          "hub:fixture",
          "--runtime-version",
          "0.1.0",
          "--manager",
          "launchd",
          "--registry",
          resolve(root, "state/node-fleet.json"),
          "--home",
          resolve(root, "home"),
          "--json",
        ],
        io(root, output, []),
      ),
    ).toBe(0);
    expect(JSON.parse(output.join(""))).toMatchObject({
      planKind: "repository_node_onboarding",
      outcome: "reconcile_required",
      registry: { reconciliation: "register" },
      service: { activation: "not_observed", readiness: "not_observed" },
      privacy: { credentials: "excluded" },
    });
    await expect(readFile(resolve(root, "state/node-fleet.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("commits a registered upgrade after stable offline observations only for Hub unavailability", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-cli-repository-node-offline-upgrade-"));
    const repository = resolve(root, "repository");
    const home = resolve(root, "home");
    const registry = resolve(root, "state/node-fleet.json");
    await mkdir(repository);
    expect(
      await runCli(["init", "--root", repository, "--name", "offline-fixture"], io(root, [], [])),
    ).toBe(0);
    const manifestPath = resolve(repository, ".lervo/project.yaml");
    await writeFile(
      manifestPath,
      (await readFile(manifestPath, "utf8")).replace(
        "hubSyncEnabled: false",
        "hubSyncEnabled: true",
      ),
    );
    const token = resolve(root, "node.token");
    const config = resolve(root, "node-runtime.json");
    const executable = resolve(root, "lervo-node");
    await writeFile(token, "fixture-token\n", { mode: 0o600 });
    await writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    await chmod(executable, 0o755);
    await writeFile(
      config,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          repositoryRoot: repository,
          hub: {
            baseUrl: "https://hub.example.test/",
            bearerTokenFile: token,
            destinationId: "hub:offline",
            hubIdentityHash: `sha256:${"a".repeat(64)}`,
          },
          sync: { workerId: "node:offline" },
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    await chmod(config, 0o600);
    const plan = await createNodeFleetOnboardingPlan({
      registryPath: registry,
      repositoryRoot: repository,
      nodeId: "node_offline_device_01",
      destinationId: "hub:offline",
      runtimeVersion: "0.1.0",
      serviceManager: "launchd",
      homeDirectory: home,
    });
    let active = false;
    const startedAt = new Date(Date.now() + 1_000).toISOString();
    await mkdir(resolve(plan.desired.healthPath, ".."), { recursive: true });
    await writeFile(
      plan.desired.healthPath,
      `${JSON.stringify({
        schemaVersion: 1,
        status: "degraded",
        processId: 4321,
        startedAt,
        updatedAt: new Date(Date.now() + 2_000).toISOString(),
        sync: { status: "unavailable", failureCode: "hub_unavailable" },
        workstreamReplication: { status: "unavailable", failureCode: "hub_unavailable" },
        workspaceCoordination: { status: "disabled" },
        remoteControl: { status: "disabled" },
      })}\n`,
      { mode: 0o600 },
    );
    const receipt = await applyNodeFleetOnboarding({
      plan,
      configPath: config,
      homeDirectory: home,
      allowHubUnavailableReadiness: true,
      ports: {
        executablePath: executable,
        serviceOptions: {
          platform: "darwin",
          uid: 501,
          homeDirectory: home,
          wait: async () => undefined,
          runCommand: async (_command, args) => {
            if (args[0] === "bootstrap") active = true;
            if (args[0] === "bootout") active = false;
            return { exitCode: args[0] === "print" ? (active ? 0 : 1) : 0 };
          },
        },
        wait: async () => undefined,
      },
    });
    expect(receipt.readiness).toEqual(
      expect.objectContaining({
        status: "offline_ready",
        observations: 3,
        sync: "unavailable:hub_unavailable",
        workstreamReplication: "unavailable:hub_unavailable",
        remoteControl: "disabled",
      }),
    );
    expect(await listNodeFleetInstances(registry)).toHaveLength(1);
  });

  it("requires write authorization, stores locally, and revalidates on resolve", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-cli-repository-"));
    const repository = resolve(root, "repository");
    const registry = resolve(root, "state/repositories.json");
    await mkdir(repository);
    expect(
      await runCli(["init", "--root", repository, "--name", "fixture"], io(root, [], [])),
    ).toBe(0);

    const unauthorizedErrors: string[] = [];
    expect(
      await runCli(
        ["repository", "register", "--root", repository, "--registry", registry],
        io(root, [], unauthorizedErrors),
      ),
    ).toBe(1);
    expect(unauthorizedErrors.join("")).toContain("repository_write_required");

    const registeredOutput: string[] = [];
    expect(
      await runCli(
        [
          "repository",
          "register",
          "--root",
          repository,
          "--registry",
          registry,
          "--write",
          "--json",
        ],
        io(root, registeredOutput, []),
      ),
    ).toBe(0);
    const registration = JSON.parse(registeredOutput.join("")).registration;
    expect(registration).toMatchObject({
      name: "fixture",
      repositoryRoot: await realpath(repository),
    });

    const listOutput: string[] = [];
    expect(
      await runCli(
        ["repository", "list", "--registry", registry, "--json"],
        io(root, listOutput, []),
      ),
    ).toBe(0);
    expect(JSON.parse(listOutput.join(""))).toMatchObject({
      verification: "stored_only",
      repositories: [{ projectId: registration.projectId }],
    });

    const resolvedOutput: string[] = [];
    expect(
      await runCli(
        [
          "repository",
          "resolve",
          "--project",
          registration.projectId,
          "--registry",
          registry,
          "--json",
        ],
        io(root, resolvedOutput, []),
      ),
    ).toBe(0);
    expect(JSON.parse(resolvedOutput.join(""))).toMatchObject({
      verification: "manifest_revalidated",
      registration: { projectId: registration.projectId },
    });

    const manifestPath = resolve(repository, ".lervo/project.yaml");
    await writeFile(
      manifestPath,
      (await readFile(manifestPath, "utf8")).replace("name: fixture", "name: changed"),
    );
    const staleErrors: string[] = [];
    expect(
      await runCli(
        ["repository", "resolve", "--project", registration.projectId, "--registry", registry],
        io(root, [], staleErrors),
      ),
    ).toBe(1);
    expect(staleErrors.join("")).toContain("repository_registration_stale");
  });
});
