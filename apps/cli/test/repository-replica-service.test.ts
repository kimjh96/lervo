import { chmod, mkdir, mkdtemp, readFile, readlink, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  currentNodeRuntimePayload,
  nodeRuntimeDirectoryName,
  nodeRuntimesDirectory,
  pointCurrentNodeRuntime,
  readCurrentNodeRuntime,
} from "../src/node-runtime-pointer.js";
import { migrateReplicaConfig } from "../src/repository-replica-config-migration.js";
import {
  applyRepositoryReplicaService,
  inspectRepositoryReplicaService,
  repositoryReplicaConfigPath,
} from "../src/repository-replica-service.js";
import type { RepositoryReplicaServicePorts } from "../src/repository-replica-service-ports.js";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

const OLD = "0123456789abcdef";
const NEW = "fedcba9876543210";

async function installRuntime(home: string, name: string): Promise<void> {
  const directory = resolve(nodeRuntimesDirectory(home, "darwin"), name);
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, "node-runtime.js"), `// runtime ${name}\n`, { mode: 0o600 });
}

/** The record a running payload writes at startup (ADR-0573 binding proof). */
async function bindProcess(home: string, runtime: string, pid: number, identity: string) {
  const directory = resolve(nodeRuntimesDirectory(home, "darwin"), runtime, ".processes");
  await mkdir(directory, { recursive: true });
  await writeFile(
    resolve(directory, `${pid}.json`),
    JSON.stringify({
      schemaVersion: 1,
      processId: pid,
      processIdentity: identity,
      runtimeDirectory: runtime,
    }),
    { mode: 0o600 },
  );
}

const birth = (pid: number) => `proc_test_v1:sha256:${pid.toString(16).padStart(64, "0")}`;

async function fixture(options: { coordinator?: boolean; nodes?: boolean; legacy?: unknown } = {}) {
  const home = await mkdtemp(resolve(tmpdir(), "lervo-replica-service-"));
  directories.push(home);
  const state = resolve(home, "state");
  const bin = resolve(home, "bin");
  await mkdir(bin, { recursive: true });
  await mkdir(state, { recursive: true });
  for (const name of ["node", "git"]) {
    await writeFile(resolve(bin, name), "#!/bin/sh\n");
    await chmod(resolve(bin, name), 0o755);
  }
  const environment = { LERVO_USER_STATE_DIRECTORY: state, PATH: bin };
  const legacyConfigPath = resolve(home, ".lervo", "repository-replica-coordinator.json");
  if (options.legacy !== undefined) {
    await mkdir(resolve(legacyConfigPath, ".."), { recursive: true });
    await writeFile(
      legacyConfigPath,
      typeof options.legacy === "string" ? options.legacy : JSON.stringify(options.legacy),
      { mode: 0o600 },
    );
  }
  if (options.coordinator === true)
    await writeFile(repositoryReplicaConfigPath(environment), "{}\n", { mode: 0o600 });
  const target = resolve(home, "Library", "LaunchAgents", "dev.lervo.repository-replica.plist");
  const status = {
    managerAvailable: true,
    installed: false,
    enabled: null as boolean | null,
    active: false,
    processId: null as number | null,
  };
  // Live coordinator processes and their birth identities; a started process binds itself to
  // the runtime `current` names, as the installed payload does.
  const running = new Map<number, string>();
  let nextPid = 4100;
  const startProcess = async (runtime: string | null) => {
    if (status.processId !== null) running.delete(status.processId);
    const pid = (nextPid += 1);
    running.set(pid, birth(pid));
    if (runtime !== null) await bindProcess(home, runtime, pid, birth(pid));
    return pid;
  };
  const manage = vi.fn(async (args: string[]) => {
    const action = args[args.indexOf("--action") + 1];
    if (action === "status") return { ...status };
    const definition = await readFile(args[args.indexOf("--definition") + 1]!);
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, definition, { mode: 0o600 });
    const processId = await startProcess(await readCurrentNodeRuntime(home, "darwin"));
    Object.assign(status, { installed: true, active: true, enabled: true, processId });
    return {
      ...status,
      change: action === "upgrade" ? "upgraded" : action === "restart" ? "restarted" : "installed",
    };
  });
  const materialize = vi.fn(async () => installRuntime(home, NEW));
  const ports: RepositoryReplicaServicePorts = {
    platform: "darwin",
    homeDirectory: home,
    uid: 501,
    environment,
    bundledRuntime: async () => NEW,
    materializeRuntime: materialize,
    legacyConfigPath,
    hostRunsNodes: async () => options.nodes ?? false,
    nodeExecutable: async () => resolve(bin, "node"),
    manage,
    observeProcess: (pid) => {
      const identity = running.get(pid);
      return identity === undefined ? { status: "absent" } : { status: "present", identity };
    },
  };
  return {
    home,
    target,
    status,
    manage,
    materialize,
    ports,
    legacyConfigPath,
    environment,
    running,
    startProcess,
  };
}

describe("current Node runtime pointer (ADR-0483)", () => {
  it("creates, swaps, and keeps the pointer only at an installed runtime", async () => {
    const home = await mkdtemp(resolve(tmpdir(), "lervo-runtime-pointer-"));
    directories.push(home);
    await installRuntime(home, OLD);
    await installRuntime(home, NEW);
    const point = (runtimeDirectory: string) =>
      pointCurrentNodeRuntime({ runtimeDirectory, homeDirectory: home, platform: "darwin" });

    await expect(point(OLD)).resolves.toBe("created");
    await expect(point(OLD)).resolves.toBe("unchanged");
    await expect(point(NEW)).resolves.toBe("updated");
    expect(await readCurrentNodeRuntime(home, "darwin")).toBe(NEW);
    // The pointer is relative, so the payload path resolves through it.
    expect(await readlink(resolve(nodeRuntimesDirectory(home, "darwin"), "current"))).toBe(NEW);
    expect(await readFile(currentNodeRuntimePayload(home, "darwin"), "utf8")).toBe(
      `// runtime ${NEW}\n`,
    );
    await expect(point("aaaaaaaaaaaaaaaa")).rejects.toThrow();
    await expect(point("../escape")).rejects.toThrow("invalid");
    expect(await readCurrentNodeRuntime(home, "darwin")).toBe(NEW);
  });

  it("recognizes only launchers inside the runtimes directory", () => {
    const runtimes = nodeRuntimesDirectory("/home/user", "linux");
    expect(runtimes).toBe("/home/user/.local/share/lervo/runtimes/node");
    expect(
      nodeRuntimeDirectoryName(`${runtimes}/${NEW}/lervo-node-launcher-x`, "/home/user", "linux"),
    ).toBe(NEW);
    expect(nodeRuntimeDirectoryName("/opt/node/bin.js", "/home/user", "linux")).toBeNull();
  });
});

describe("repository replica service stage (ADR-0483)", () => {
  it("does nothing on a host that neither coordinates nor runs a Node", async () => {
    const { ports, manage } = await fixture();
    expect(await inspectRepositoryReplicaService(ports)).toMatchObject({
      disposition: "current",
      reason: "replica_not_configured",
      runtime: null,
    });
    expect(manage).not.toHaveBeenCalled();
  });

  it("moves a peer host's pointer to the bundled runtime without a coordinator service", async () => {
    const { ports, home, materialize, manage } = await fixture({ nodes: true });
    await installRuntime(home, OLD);
    await pointCurrentNodeRuntime({
      runtimeDirectory: OLD,
      homeDirectory: home,
      platform: "darwin",
    });
    const stage = await inspectRepositoryReplicaService(ports);
    expect(stage).toMatchObject({
      disposition: "safe_apply",
      reason: "runtime_pointer_stale",
      runtime: NEW,
      pointerAction: "update",
      action: "none",
    });
    await expect(applyRepositoryReplicaService(stage, ports)).resolves.toEqual({
      pointerAction: "update",
      configMigration: "none",
      serviceChange: null,
    });
    expect(materialize).toHaveBeenCalledOnce();
    expect(await readCurrentNodeRuntime(home, "darwin")).toBe(NEW);
    expect(manage).not.toHaveBeenCalled();
    expect(await inspectRepositoryReplicaService(ports)).toMatchObject({
      disposition: "current",
      reason: "runtime_pointer_current",
    });
  });

  it("replaces a hand-written coordinator definition with one that runs through the pointer", async () => {
    const { ports, home, target, manage } = await fixture({ coordinator: true });
    await mkdir(resolve(target, ".."), { recursive: true });
    // The hand-written plist pins one content-addressed runtime, as on the Mac before ADR-0483.
    await writeFile(target, `<plist>${OLD}/node-runtime.js</plist>\n`, { mode: 0o600 });
    const stage = await inspectRepositoryReplicaService(ports);
    expect(stage).toMatchObject({
      disposition: "safe_apply",
      reason: "replica_service_outdated",
      serviceIdentity: "dev.lervo.repository-replica",
      pointerAction: "create",
      action: "upgrade",
    });
    expect(JSON.stringify(stage)).not.toContain(home);

    await applyRepositoryReplicaService(stage, ports);
    const definition = await readFile(target, "utf8");
    expect(definition).toContain("<string>dev.lervo.repository-replica</string>");
    expect(definition).toContain(`<string>${currentNodeRuntimePayload(home, "darwin")}</string>`);
    expect(definition).toContain(
      "<string>repository-replica</string>\n    <string>reconcile</string>\n    <string>--watch</string>",
    );
    const upgrade = manage.mock.calls.find((call) => call[0].includes("upgrade"))![0] as string[];
    expect(upgrade).toContain("--previous-definition");
    expect(upgrade[upgrade.indexOf("--runtime") + 1]).toBe("repository-replica");

    // Later deploys move only the pointer; the definition stays byte-identical.
    expect(await inspectRepositoryReplicaService(ports)).toMatchObject({
      disposition: "current",
      reason: "replica_service_current",
    });
    await installRuntime(home, OLD);
    await pointCurrentNodeRuntime({
      runtimeDirectory: OLD,
      homeDirectory: home,
      platform: "darwin",
    });
    expect(await inspectRepositoryReplicaService(ports)).toMatchObject({
      disposition: "safe_apply",
      reason: "runtime_pointer_stale",
      action: "none",
    });
  });

  it("refuses a plan that changed after approval", async () => {
    const { ports, target } = await fixture({ coordinator: true });
    const stage = await inspectRepositoryReplicaService(ports);
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, "<plist>changed</plist>\n", { mode: 0o600 });
    await expect(applyRepositoryReplicaService(stage, ports)).rejects.toMatchObject({
      code: "replica_service_plan_stale",
    });
  });
});

describe("stale coordinator runtime restart (ADR-0573)", () => {
  /** An installed, running coordinator whose process loaded `bound`; `current` names `pointer`. */
  async function runningCoordinator(input: { bound: string | null; pointer: string }) {
    const value = await fixture({ coordinator: true });
    await installRuntime(value.home, OLD);
    await installRuntime(value.home, NEW);
    await pointCurrentNodeRuntime({
      runtimeDirectory: NEW,
      homeDirectory: value.home,
      platform: "darwin",
    });
    await applyRepositoryReplicaService(
      await inspectRepositoryReplicaService(value.ports),
      value.ports,
    );
    // Replace the started process with one that loaded `bound` (null: a payload that predates
    // process bindings), then point `current` where the scenario needs it.
    value.status.processId = await value.startProcess(input.bound);
    await pointCurrentNodeRuntime({
      runtimeDirectory: input.pointer,
      homeDirectory: value.home,
      platform: "darwin",
    });
    value.manage.mockClear();
    return value;
  }

  const restarts = (manage: { mock: { calls: unknown[][] } }) =>
    manage.mock.calls
      .map((call) => call[0] as string[])
      .filter((args) => args[args.indexOf("--action") + 1] === "restart");

  it("restarts an unchanged definition whose process loaded an older runtime", async () => {
    const { ports, manage, target, status } = await runningCoordinator({
      bound: OLD,
      pointer: NEW,
    });
    const definition = await readFile(target);
    const stale = status.processId;
    const stage = await inspectRepositoryReplicaService(ports);
    expect(stage).toMatchObject({
      disposition: "safe_apply",
      reason: "replica_service_stale_runtime",
      pointerAction: "none",
      action: "restart",
    });
    expect(stage.definitionHash).toBe(stage.installedDefinitionHash);
    await expect(applyRepositoryReplicaService(stage, ports)).resolves.toEqual({
      pointerAction: "none",
      configMigration: "none",
      serviceChange: "restarted",
    });
    const [restart] = restarts(manage);
    expect(restart).not.toContain("--previous-definition");
    expect(restart![restart!.indexOf("--runtime") + 1]).toBe("repository-replica");
    expect(await readFile(target)).toEqual(definition);
    expect(status.processId).not.toBe(stale);
    expect(await inspectRepositoryReplicaService(ports)).toMatchObject({
      disposition: "current",
      reason: "replica_service_current",
      action: "none",
    });
  });

  it("restarts a process with no binding, such as one started by a pre-binding payload", async () => {
    const { ports } = await runningCoordinator({ bound: null, pointer: NEW });
    expect(await inspectRepositoryReplicaService(ports)).toMatchObject({
      reason: "replica_service_stale_runtime",
      action: "restart",
    });
  });

  it("does not accept a reused process id as proof of the current runtime", async () => {
    const { ports, running, status } = await runningCoordinator({ bound: NEW, pointer: NEW });
    running.set(status.processId!, birth(1));
    expect(await inspectRepositoryReplicaService(ports)).toMatchObject({
      reason: "replica_service_stale_runtime",
      action: "restart",
    });
    running.delete(status.processId!);
    status.processId = null;
    expect(await inspectRepositoryReplicaService(ports)).toMatchObject({
      reason: "replica_service_stale_runtime",
      action: "restart",
    });
  });

  it("moves the pointer before restarting a process bound to the previous runtime", async () => {
    const { ports, manage, home } = await runningCoordinator({ bound: OLD, pointer: OLD });
    const stage = await inspectRepositoryReplicaService(ports);
    expect(stage).toMatchObject({
      reason: "replica_service_stale_runtime",
      runtime: NEW,
      pointerAction: "update",
      action: "restart",
    });
    await applyRepositoryReplicaService(stage, ports);
    expect(await readCurrentNodeRuntime(home, "darwin")).toBe(NEW);
    expect(restarts(manage)).toHaveLength(1);
    expect(await inspectRepositoryReplicaService(ports)).toMatchObject({ disposition: "current" });
  });

  it("leaves a process bound to the current runtime running", async () => {
    const { ports, manage } = await runningCoordinator({ bound: NEW, pointer: NEW });
    const stage = await inspectRepositoryReplicaService(ports);
    expect(stage).toMatchObject({
      disposition: "current",
      reason: "replica_service_current",
      action: "none",
    });
    await expect(applyRepositoryReplicaService(stage, ports)).resolves.toBeNull();
    expect(restarts(manage)).toHaveLength(0);
  });

  it("activates a stopped coordinator without judging a process", async () => {
    const { ports, status, manage } = await runningCoordinator({ bound: OLD, pointer: NEW });
    Object.assign(status, { active: false, processId: null });
    const stage = await inspectRepositoryReplicaService(ports);
    expect(stage).toMatchObject({ reason: "replica_service_inactive", action: "activate" });
    await applyRepositoryReplicaService(stage, ports);
    expect(restarts(manage)).toHaveLength(0);
  });

  it("restarts once when two upgrades apply the same stale plan at the same time", async () => {
    const { ports, manage } = await runningCoordinator({ bound: OLD, pointer: NEW });
    const stage = await inspectRepositoryReplicaService(ports);
    const restart = manage.getMockImplementation()!;
    // A restart takes time, so the second apply arrives while the first still holds the host.
    manage.mockImplementation(async (args: string[]) => {
      if (args[args.indexOf("--action") + 1] === "restart")
        await new Promise((done) => setTimeout(done, 400));
      return restart(args);
    });
    const receipts = await Promise.all([
      applyRepositoryReplicaService(stage, ports),
      applyRepositoryReplicaService(stage, ports),
    ]);
    expect(receipts.filter((receipt) => receipt?.serviceChange === "restarted")).toHaveLength(1);
    expect(receipts.filter((receipt) => receipt === null)).toHaveLength(1);
    expect(restarts(manage)).toHaveLength(1);
  });

  it("applies nothing when the coordinator already restarted onto the current runtime", async () => {
    const { ports, status, startProcess } = await runningCoordinator({ bound: OLD, pointer: NEW });
    const stage = await inspectRepositoryReplicaService(ports);
    status.processId = await startProcess(NEW);
    // The coordinator restarted on its own and loaded `current`; nothing is left to apply.
    await expect(applyRepositoryReplicaService(stage, ports)).resolves.toBeNull();
  });
});

describe("legacy coordinator configuration migration (ADR-0483)", () => {
  // The Mac's configuration before ADR-0483, with the peer pinned to one WSL runtime.
  const legacy = {
    schemaVersion: 1,
    stateFile: "/Users/owner/.lervo/state/repository-replicas.json",
    pollIntervalMs: 30_000,
    peer: {
      executable: "/usr/bin/ssh",
      arguments: ["-o", "BatchMode=yes"],
      destination: "owner@wsl",
      remoteNodeExecutable: "/home/jonghyeok/.local/bin/node",
      remoteRuntimeExecutable:
        "/home/jonghyeok/.local/share/lervo/runtimes/node/6722dd85a39d6c93/node-runtime.js",
    },
    repositories: [{ replicaId: "plen", localRoot: "/Users/owner/plen", peerRoot: "/home/plen" }],
  };

  it("converts a pinned peer runtime to the pointer and keeps every other field", () => {
    expect(migrateReplicaConfig(legacy)).toEqual({
      config: {
        ...legacy,
        peer: {
          executable: "/usr/bin/ssh",
          arguments: ["-o", "BatchMode=yes"],
          destination: "owner@wsl",
          remoteNodeExecutable: "/home/jonghyeok/.local/bin/node",
          remoteRuntimesDirectory: "/home/jonghyeok/.local/share/lervo/runtimes/node",
        },
      },
      peerRuntime: "pointer",
    });
    const custom = { ...legacy, peer: { ...legacy.peer, remoteRuntimeExecutable: "/opt/x.js" } };
    expect(migrateReplicaConfig(custom)).toEqual({
      config: custom,
      peerRuntime: "explicit_override",
    });
    expect(migrateReplicaConfig([])).toBeNull();
  });

  it("moves the legacy file into the user state directory and renders the service against it", async () => {
    const { ports, target, legacyConfigPath, environment, home } = await fixture({ legacy });
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, `<plist>${OLD}/node-runtime.js</plist>\n`, { mode: 0o600 });
    const original = await readFile(legacyConfigPath, "utf8");

    const stage = await inspectRepositoryReplicaService(ports);
    expect(stage).toMatchObject({
      disposition: "safe_apply",
      reason: "replica_config_legacy",
      configMigration: "migrate",
      peerRuntimeOverride: false,
      action: "upgrade",
    });
    expect(JSON.stringify(stage)).not.toContain(home);
    await expect(applyRepositoryReplicaService(stage, ports)).resolves.toMatchObject({
      configMigration: "migrate",
      serviceChange: "upgraded",
    });

    const migratedPath = repositoryReplicaConfigPath(environment);
    expect((await stat(migratedPath)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(migratedPath, "utf8")).peer).toEqual({
      executable: "/usr/bin/ssh",
      arguments: ["-o", "BatchMode=yes"],
      destination: "owner@wsl",
      remoteNodeExecutable: "/home/jonghyeok/.local/bin/node",
      remoteRuntimesDirectory: "/home/jonghyeok/.local/share/lervo/runtimes/node",
    });
    // A backup keeps the original bytes, and the legacy location is no longer read.
    expect(await readFile(`${legacyConfigPath}.pre-adr-0483`, "utf8")).toBe(original);
    await expect(stat(legacyConfigPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(target, "utf8")).toContain(`<string>${migratedPath}</string>`);
    expect(await inspectRepositoryReplicaService(ports)).toMatchObject({
      disposition: "current",
      configMigration: "none",
    });
  });

  it("keeps a runtime path outside any runtimes directory as a reported override", async () => {
    const custom = { ...legacy, peer: { ...legacy.peer, remoteRuntimeExecutable: "/opt/x.js" } };
    const { ports } = await fixture({ legacy: custom });
    expect(await inspectRepositoryReplicaService(ports)).toMatchObject({
      reason: "replica_config_legacy",
      configMigration: "migrate",
      peerRuntimeOverride: true,
    });
  });

  it("reports a peer that launches wsl.exe for every step without rewriting the configuration", async () => {
    const { ports, environment } = await fixture({ coordinator: true });
    expect(await inspectRepositoryReplicaService(ports)).toMatchObject({ peerLauncher: null });
    const configuration = JSON.stringify({
      ...legacy,
      peer: { ...legacy.peer, remoteCommandPrefix: ["wsl.exe", "-d", "Ubuntu", "--"] },
    });
    await writeFile(repositoryReplicaConfigPath(environment), configuration, { mode: 0o600 });
    expect(await inspectRepositoryReplicaService(ports)).toMatchObject({ peerLauncher: "wsl.exe" });
    expect(await readFile(repositoryReplicaConfigPath(environment), "utf8")).toBe(configuration);
    const migrating = await fixture({
      legacy: { ...legacy, peer: { ...legacy.peer, remoteCommandPrefix: ["wsl.exe"] } },
    });
    expect(await inspectRepositoryReplicaService(migrating.ports)).toMatchObject({
      configMigration: "migrate",
      peerLauncher: "wsl.exe",
    });
  });

  it("blocks on an unreadable legacy file and prefers an existing managed configuration", async () => {
    const broken = await fixture({ legacy: "{not json" });
    expect(await inspectRepositoryReplicaService(broken.ports)).toMatchObject({
      disposition: "blocked",
      reason: "replica_config_legacy_invalid",
    });
    const both = await fixture({ legacy, coordinator: true });
    expect(await inspectRepositoryReplicaService(both.ports)).toMatchObject({
      configMigration: "none",
    });
  });
});
