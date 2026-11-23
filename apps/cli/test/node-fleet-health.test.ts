import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/main.js";
import { applyNodeFleetOnboarding, inspectNodeFleetStatus } from "../src/node-fleet-apply.js";
import { holdProcessPresence } from "@lervo/project-storage";
import { createNodeFleetOnboardingPlan, listNodeFleetInstances } from "@lervo/repository-registry";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function io(cwd: string) {
  return { cwd, stdout: () => undefined, stderr: () => undefined };
}

const running = (active: () => boolean) => ({
  platform: "darwin" as const,
  uid: 501,
  wait: async () => undefined,
  runCommand: async (_command: string, args: string[]) =>
    args[0] === "print"
      ? { exitCode: active() ? 0 : 1, stdout: active() ? "\tstate = running\n" : "" }
      : { exitCode: 0 },
});

/** One registered, running repository Node whose health file the test writes. */
async function registeredNode() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-node-fleet-health-"));
  roots.push(root);
  const repository = resolve(root, "repository");
  const home = resolve(root, "home");
  const registry = resolve(root, "state/node-fleet.json");
  await mkdir(repository);
  expect(await runCli(["init", "--root", repository, "--name", "fixture"], io(root))).toBe(0);
  const manifestPath = resolve(repository, ".lervo/project.yaml");
  await writeFile(
    manifestPath,
    (await readFile(manifestPath, "utf8")).replace("hubSyncEnabled: false", "hubSyncEnabled: true"),
  );
  const token = resolve(root, "node.token");
  const config = resolve(root, "node-runtime.json");
  const executable = resolve(root, "lervo-node");
  await writeFile(token, "fixture-token\n", { mode: 0o600 });
  await writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await chmod(executable, 0o755);
  await writeFile(
    config,
    `${JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: repository,
      hub: {
        baseUrl: "https://hub.example.test/",
        bearerTokenFile: token,
        destinationId: "hub:fixture",
        hubIdentityHash: `sha256:${"a".repeat(64)}`,
      },
      sync: { workerId: "node:fixture" },
    })}\n`,
    { mode: 0o600 },
  );
  let active = false;
  const startedAt = new Date(Date.now() + 1_000).toISOString();
  const serviceOptions = {
    ...running(() => active),
    homeDirectory: home,
    runCommand: async (command: string, args: string[]) => {
      if (args[0] === "bootstrap") active = true;
      return running(() => active).runCommand(command, args);
    },
  };
  let reads = 0;
  await applyNodeFleetOnboarding({
    plan: await createNodeFleetOnboardingPlan({
      registryPath: registry,
      repositoryRoot: repository,
      nodeId: "node_fixture_device_01",
      destinationId: "hub:fixture",
      runtimeVersion: "0.1.0",
      serviceManager: "launchd",
      homeDirectory: home,
    }),
    configPath: config,
    homeDirectory: home,
    ports: {
      executablePath: executable,
      serviceOptions,
      wait: async () => undefined,
      readHealth: async () => ({
        ...health(startedAt, new Date(Date.now() + ++reads * 1_000).toISOString()),
      }),
    },
  });
  const [registration] = await listNodeFleetInstances(registry);
  return { registry, home, serviceOptions, healthPath: registration!.healthPath };
}

function health(startedAt: string, updatedAt: string, status = "ready") {
  return {
    schemaVersion: 1 as const,
    status: status as "ready",
    processId: 4321,
    startedAt,
    updatedAt,
    sync: { status: "ready" as const },
    workstreamReplication: { status: "ready" as const },
    workspaceCoordination: { status: "disabled" as const },
    remoteControl: { status: "disabled" as const },
  };
}

describe("Node fleet apply of an unchanged service (ADR-0602)", () => {
  it("accepts the running Node's own snapshot when the service needed no restart", async () => {
    const node = await registeredNode();
    const repository = resolve(node.registry, "../../repository");
    const config = resolve(node.registry, "../../node-runtime.json");
    const executable = resolve(node.registry, "../../lervo-node");
    // The running process wrote this once, long before the new release.
    const idle = health("2026-11-22T08:00:00.000Z", "2026-11-22T08:00:05.000Z");
    const result = await applyNodeFleetOnboarding({
      plan: await createNodeFleetOnboardingPlan({
        registryPath: node.registry,
        repositoryRoot: repository,
        nodeId: "node_fixture_device_01",
        destinationId: "hub:fixture",
        runtimeVersion: "0.1.1",
        serviceManager: "launchd",
        homeDirectory: node.home,
      }),
      configPath: config,
      homeDirectory: node.home,
      ports: {
        executablePath: executable,
        serviceOptions: node.serviceOptions,
        wait: async () => undefined,
        readHealth: async () => idle,
      },
    });
    expect(result).toMatchObject({ readiness: { status: "ready" } });
  });
});

describe("Node fleet status of an idle Node (ADR-0602)", () => {
  it("keeps an idle settled Node ready while its process runs, however old its snapshot", async () => {
    const node = await registeredNode();
    // Written once at startup; an idle Node then runs no cycle and writes nothing for hours.
    const snapshot = health("2026-11-22T08:00:00.000Z", "2026-11-22T08:00:05.000Z");
    await mkdir(resolve(node.healthPath, ".."), { recursive: true });
    await writeFile(node.healthPath, `${JSON.stringify(snapshot)}\n`, { mode: 0o600 });
    const now = new Date("2026-11-22T10:30:00.000Z");
    const inspect = (processRunning: () => Promise<boolean>) =>
      inspectNodeFleetStatus({
        registryPath: node.registry,
        homeDirectory: node.home,
        ports: { serviceOptions: node.serviceOptions, processRunning },
        now,
      });

    const live = await inspect(async () => true);
    expect(live.instances[0]).toMatchObject({
      runtime: { status: "ready" },
      recoveryAction: "none",
    });

    const gone = await inspect(async () => false);
    expect(gone.instances[0]).toMatchObject({
      runtime: { status: "stale" },
      recoveryAction: "inspect_runtime_failure",
    });
  });

  it("trusts the recorded presence over the process id, which a clock step can mislead", async () => {
    const node = await registeredNode();
    // A short directory keeps the socket path within the local socket bound.
    const presenceRoot = await mkdtemp("/tmp/lervo-fp-");
    roots.push(presenceRoot);
    const previous = process.env.LERVO_USER_STATE_DIRECTORY;
    process.env.LERVO_USER_STATE_DIRECTORY = presenceRoot;
    try {
      const presence = holdProcessPresence();
      await presence.ready;
      expect(presence.issue()).toBeNull();
      const snapshot = {
        ...health("2026-11-22T08:00:00.000Z", "2026-11-22T08:00:05.000Z"),
        presenceToken: presence.token,
      };
      await mkdir(resolve(node.healthPath, ".."), { recursive: true });
      await writeFile(node.healthPath, `${JSON.stringify(snapshot)}\n`, { mode: 0o600 });
      const inspect = (processRunning: () => Promise<boolean>) =>
        inspectNodeFleetStatus({
          registryPath: node.registry,
          homeDirectory: node.home,
          ports: { serviceOptions: node.serviceOptions, processRunning },
          now: new Date("2026-11-22T10:30:00.000Z"),
        });

      // After a wall-clock step the start-time check fails; the live presence still answers.
      expect((await inspect(async () => false)).instances[0]).toMatchObject({
        runtime: { status: "ready" },
        recoveryAction: "none",
      });
      presence.release();
      // A presence that no longer answers is never trusted alone: the process id decides.
      await expect
        .poll(async () => (await inspect(async () => false)).instances[0]?.runtime.status, {
          timeout: 5_000,
        })
        .toBe("stale");
      expect((await inspect(async () => true)).instances[0]?.runtime.status).toBe("ready");
    } finally {
      if (previous === undefined) delete process.env.LERVO_USER_STATE_DIRECTORY;
      else process.env.LERVO_USER_STATE_DIRECTORY = previous;
    }
  });

  it("still judges a starting snapshot by its heartbeat age", async () => {
    const node = await registeredNode();
    const snapshot = health("2026-11-22T08:00:00.000Z", "2026-11-22T08:00:05.000Z", "starting");
    await mkdir(resolve(node.healthPath, ".."), { recursive: true });
    await writeFile(node.healthPath, `${JSON.stringify(snapshot)}\n`, { mode: 0o600 });
    const report = await inspectNodeFleetStatus({
      registryPath: node.registry,
      homeDirectory: node.home,
      ports: { serviceOptions: node.serviceOptions, processRunning: async () => true },
      now: new Date("2026-11-22T10:30:00.000Z"),
    });
    expect(report.instances[0]).toMatchObject({ runtime: { status: "stale" } });
  });
});
