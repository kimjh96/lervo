import { chmod, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { inspectTerminalRepositoryReplicaService } from "../src/terminal-repository-replica-service-inspection.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<{ home: string; definition: string }> {
  const home = await mkdtemp(resolve(tmpdir(), "lervo-replica-service-inspection-"));
  roots.push(home);
  const directory = resolve(home, "Library", "LaunchAgents");
  await mkdir(directory, { recursive: true });
  const definition = resolve(directory, "dev.lervo.repository-replica.plist");
  await writeFile(definition, "<plist/>", { mode: 0o600 });
  await chmod(definition, 0o600);
  return { home, definition };
}

it("requires an installed repository replica service to remain loaded", async () => {
  const value = await fixture();
  const serviceLoaded = vi.fn(async () => false);
  await expect(
    inspectTerminalRepositoryReplicaService({
      platform: "darwin",
      homeDirectory: value.home,
      uid: 501,
      serviceLoaded,
    }),
  ).resolves.toEqual([expect.objectContaining({ code: "repository_replica_service_inactive" })]);
  expect(serviceLoaded).toHaveBeenCalledWith(501);
});

it("accepts an active owner-only service and ignores hosts without one", async () => {
  const value = await fixture();
  await expect(
    inspectTerminalRepositoryReplicaService({
      platform: "darwin",
      homeDirectory: value.home,
      uid: 501,
      serviceLoaded: async () => true,
    }),
  ).resolves.toEqual([]);
  await expect(
    inspectTerminalRepositoryReplicaService({
      platform: "linux",
      homeDirectory: value.home,
    }),
  ).resolves.toEqual([]);
  await expect(
    inspectTerminalRepositoryReplicaService({
      platform: "darwin",
      homeDirectory: resolve(value.home, "absent"),
      uid: 501,
      serviceLoaded: async () => false,
    }),
  ).resolves.toEqual([]);
});

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
      serviceLoaded: async () => true,
    }),
  ).resolves.toEqual([
    expect.objectContaining({ code: "repository_replica_service_definition_unsafe" }),
  ]);
});
