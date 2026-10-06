import { chmod, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
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
import {
  applyRepositoryReplicaService,
  inspectRepositoryReplicaService,
  repositoryReplicaConfigPath,
  type RepositoryReplicaServicePorts,
} from "../src/repository-replica-service.js";

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

async function fixture(options: { coordinator?: boolean; nodes?: boolean } = {}) {
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
  if (options.coordinator === true)
    await writeFile(repositoryReplicaConfigPath(environment), "{}\n", { mode: 0o600 });
  const target = resolve(home, "Library", "LaunchAgents", "dev.lervo.repository-replica.plist");
  const status = { managerAvailable: true, installed: false, enabled: null, active: false };
  const manage = vi.fn(async (args: string[]) => {
    const action = args[args.indexOf("--action") + 1];
    if (action === "status") return { ...status };
    const definition = await readFile(args[args.indexOf("--definition") + 1]!);
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, definition, { mode: 0o600 });
    Object.assign(status, { installed: true, active: true, enabled: true });
    return { ...status, change: action === "upgrade" ? "upgraded" : "installed" };
  });
  const materialize = vi.fn(async () => installRuntime(home, NEW));
  const ports: RepositoryReplicaServicePorts = {
    platform: "darwin",
    homeDirectory: home,
    uid: 501,
    environment,
    bundledRuntime: async () => NEW,
    materializeRuntime: materialize,
    hostRunsNodes: async () => options.nodes ?? false,
    nodeExecutable: async () => resolve(bin, "node"),
    manage,
  };
  return { home, target, status, manage, materialize, ports };
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
