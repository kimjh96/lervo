import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const description = vi.hoisted(() => ({ calls: [] as Array<string | undefined> }));
vi.mock("../src/node-fleet-runtime-material.js", async (original) => ({
  ...(await original<typeof import("../src/node-fleet-runtime-material.js")>()),
  describeInstalledNodeLauncherOnce: () => async (homeDirectory?: string) => {
    description.calls.push(homeDirectory);
    return { hash: `sha256:${"b".repeat(64)}` };
  },
}));

const { upgradeHost } = await import("../src/upgrade-host.js");

const homes: string[] = [];
afterEach(async () => {
  description.calls.splice(0);
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

describe("the upgrade host", () => {
  it.each([
    ["an isolated home", true],
    ["the live host", false],
  ])("gives the Node and replica stages one runtime description for %s", async (_, isolated) => {
    const home = await mkdtemp(resolve(tmpdir(), "lervo-upgrade-host-"));
    homes.push(home);
    const host = upgradeHost(isolated ? { homeDirectory: home } : undefined);
    expect(await host.replicaService?.bundledRuntime()).toBe("b".repeat(16));
    await host.describeNodeLauncher();
    expect(description.calls).toEqual([isolated ? home : expect.any(String), undefined]);
  });
});
