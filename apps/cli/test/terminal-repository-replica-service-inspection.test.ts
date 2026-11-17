import { chmod, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { nodeRuntimesDirectory, pointCurrentNodeRuntime } from "../src/node-runtime-pointer.js";
import {
  inspectTerminalRepositoryReplicaService,
  type ReplicaServiceObservation,
} from "../src/terminal-repository-replica-service-inspection.js";

const roots: string[] = [];
const OLD = "0123456789abcdef";
const NEW = "fedcba9876543210";
const PID = 4242;
const IDENTITY = `proc_test_v1:sha256:${"a".repeat(64)}`;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const platforms = [
  { platform: "darwin", definition: "Library/LaunchAgents/dev.lervo.repository-replica.plist" },
  { platform: "linux", definition: ".config/systemd/user/lervo-repository-replica.service" },
] as const;

async function fixture(
  platform: NodeJS.Platform = "darwin",
): Promise<{ home: string; definition: string }> {
  const home = await mkdtemp(resolve(tmpdir(), "lervo-replica-service-inspection-"));
  roots.push(home);
  const definition = resolve(
    home,
    platforms.find((item) => item.platform === platform)!.definition,
  );
  await mkdir(resolve(definition, ".."), { recursive: true });
  await writeFile(definition, "<plist/>", { mode: 0o600 });
  await chmod(definition, 0o600);
  return { home, definition };
}

/** Installs both runtimes, points `current` at NEW, and binds PID to `bound`. */
async function runtimes(home: string, platform: NodeJS.Platform, bound: string): Promise<void> {
  const root = nodeRuntimesDirectory(home, platform);
  for (const name of [OLD, NEW]) {
    await mkdir(resolve(root, name), { recursive: true });
    await writeFile(resolve(root, name, "node-runtime.js"), "export {};\n");
  }
  await pointCurrentNodeRuntime({ runtimeDirectory: NEW, homeDirectory: home, platform });
  await mkdir(resolve(root, bound, ".processes"));
  await writeFile(
    resolve(root, bound, ".processes", `${PID}.json`),
    JSON.stringify({
      schemaVersion: 1,
      processId: PID,
      processIdentity: IDENTITY,
      runtimeDirectory: bound,
    }),
  );
}

const running = (processId: number | null = PID): ReplicaServiceObservation => ({
  managerAvailable: true,
  loaded: true,
  active: true,
  processId,
});

it("requires an installed repository replica service to remain loaded", async () => {
  const value = await fixture();
  const serviceStatus = vi.fn(async () => ({
    managerAvailable: true,
    loaded: false,
    active: false,
    processId: null,
  }));
  await expect(
    inspectTerminalRepositoryReplicaService({
      platform: "darwin",
      homeDirectory: value.home,
      uid: 501,
      serviceStatus,
    }),
  ).resolves.toEqual([expect.objectContaining({ code: "repository_replica_service_inactive" })]);
  expect(serviceStatus).toHaveBeenCalledWith(
    expect.objectContaining({ manager: "launchd", uid: 501 }),
  );
});

it("accepts an active owner-only service and ignores hosts without one", async () => {
  const value = await fixture();
  await runtimes(value.home, "darwin", NEW);
  const observeProcess = () => ({ status: "present" as const, identity: IDENTITY });
  await expect(
    inspectTerminalRepositoryReplicaService({
      platform: "darwin",
      homeDirectory: value.home,
      uid: 501,
      serviceStatus: async () => running(),
      observeProcess,
    }),
  ).resolves.toEqual([]);
  await expect(
    inspectTerminalRepositoryReplicaService({ platform: "win32", homeDirectory: value.home }),
  ).resolves.toEqual([]);
  await expect(
    inspectTerminalRepositoryReplicaService({
      platform: "darwin",
      homeDirectory: resolve(value.home, "absent"),
      uid: 501,
      serviceStatus: async () => running(),
    }),
  ).resolves.toEqual([]);
});

for (const { platform } of platforms) {
  it(`reports a coordinator whose process loaded another runtime on ${platform} (ADR-0573)`, async () => {
    const value = await fixture(platform);
    await runtimes(value.home, platform, OLD);
    const observeProcess = () => ({ status: "present" as const, identity: IDENTITY });
    const inspect = (observation: ReplicaServiceObservation, observe = observeProcess) =>
      inspectTerminalRepositoryReplicaService({
        platform,
        homeDirectory: value.home,
        uid: 501,
        serviceStatus: async () => observation,
        observeProcess: observe,
      });
    const stale = [{ code: "repository_replica_service_stale_runtime", command: "lervo upgrade" }];
    await expect(inspect(running())).resolves.toEqual(stale);
    // No reported process id, or an id now held by another process, proves nothing.
    await expect(inspect(running(null))).resolves.toEqual(stale);
    await expect(
      inspect(running(), () => ({
        status: "present",
        identity: `proc_test_v1:sha256:${"b".repeat(64)}`,
      })),
    ).resolves.toEqual(stale);
    // A loaded job between restarts runs no process, so it cannot be stale.
    await expect(inspect({ ...running(null), active: false })).resolves.toEqual([]);
    await expect(
      inspect({ managerAvailable: true, loaded: false, active: false, processId: null }),
    ).resolves.toEqual([
      expect.objectContaining({
        code: "repository_replica_service_inactive",
        command:
          platform === "darwin"
            ? expect.stringContaining("launchctl bootstrap")
            : "systemctl --user enable --now lervo-repository-replica.service",
      }),
    ]);
    await expect(
      inspect({ managerAvailable: false, loaded: false, active: false, processId: null }),
    ).resolves.toEqual([
      expect.objectContaining({ code: "repository_replica_service_inspection_failed" }),
    ]);
  });
}

it("rejects a symlinked repository replica service definition", async () => {
  const value = await fixture();
  await rm(value.definition);
  const target = resolve(value.home, "target.plist");
  await writeFile(target, "<plist/>", { mode: 0o600 });
  await symlink(target, value.definition);
  await expect(
    inspectTerminalRepositoryReplicaService({
      platform: "darwin",
      homeDirectory: value.home,
      uid: 501,
      serviceStatus: async () => running(),
    }),
  ).resolves.toEqual([
    expect.objectContaining({ code: "repository_replica_service_definition_unsafe" }),
  ]);
});
