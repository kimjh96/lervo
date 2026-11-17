import { lstat, mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({ dependencies: 0, failNext: false }));

// The bundled payload sits beside the built module; under test it is a fixture.
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  const bundled = (path: unknown) => String(path).endsWith("/src/node-runtime.js");
  const readFile = actual.readFile as (...args: unknown[]) => unknown;
  const lstat = actual.lstat as (...args: unknown[]) => unknown;
  return {
    ...actual,
    readFile: ((path: unknown, ...rest: unknown[]) =>
      bundled(path)
        ? Promise.resolve(Buffer.from("payload\n"))
        : readFile(path, ...rest)) as typeof actual.readFile,
    lstat: ((path: unknown, ...rest: unknown[]) =>
      bundled(path)
        ? Promise.resolve({ isFile: () => true, isSymbolicLink: () => false, size: 8 })
        : lstat(path, ...rest)) as typeof actual.lstat,
  };
});
vi.mock("../src/runtime-dependency-materialization.js", () => ({
  inspectRuntimeDependencies: async () => "current",
  materializeRuntimeDependencies: async () => undefined,
}));
vi.mock("../src/node-fleet-runtime-module.js", () => ({
  readNodeRuntimeModule: async () => ({ hash: "sha256:module" }),
  inspectNodeRuntimeModule: async () => "current",
  materializeNodeRuntimeModule: async () => undefined,
}));
vi.mock("../src/runtime-dependency-closure.js", () => ({
  describeRuntimeDependencies: async () => {
    reads.dependencies += 1;
    if (reads.failNext) {
      reads.failNext = false;
      throw new Error("The dependency closure could not be read.");
    }
    return { packages: [], manifest: "{}", hash: "closure" };
  },
}));

const {
  describeInstalledNodeLauncher,
  describeInstalledNodeLauncherOnce,
  materializeInstalledNodeLauncher,
} = await import("../src/node-fleet-runtime-material.js");

beforeEach(() => {
  reads.dependencies = 0;
  reads.failNext = false;
});

describe("the installed Node runtime description", () => {
  it("reads the bundled runtime once per owner and places it under each home", async () => {
    const describeLauncher = describeInstalledNodeLauncherOnce();
    const [first, second] = await Promise.all([
      describeLauncher("/home/one"),
      describeLauncher("/home/one"),
    ]);
    const other = await describeLauncher("/home/two");
    expect(reads.dependencies).toBe(1);
    expect(second).toEqual(first);
    expect(other.hash).toBe(first.hash);
    expect(first.launcher.startsWith(resolve("/home/one"))).toBe(true);
    expect(other.launcher.startsWith(resolve("/home/two"))).toBe(true);
  });

  it("does not keep a failed read", async () => {
    const describeLauncher = describeInstalledNodeLauncherOnce();
    reads.failNext = true;
    await expect(describeLauncher("/home/one")).rejects.toThrow("could not be read");
    await describeLauncher("/home/one");
    await describeLauncher("/home/one");
    expect(reads.dependencies).toBe(2);
  });

  it("reads again for every call without an owner", async () => {
    await describeInstalledNodeLauncher("/home/one");
    await describeInstalledNodeLauncher("/home/one");
    expect(reads.dependencies).toBe(2);
  });

  it("makes a reused runtime directory the newest while it installs the launcher", async () => {
    const home = await mkdtemp(resolve(tmpdir(), "lervo-runtime-material-"));
    try {
      const launcher = await materializeInstalledNodeLauncher(home);
      const directory = dirname(launcher);
      await utimes(directory, new Date(1_000), new Date(1_000));
      const before = Date.now();
      expect(await materializeInstalledNodeLauncher(home)).toBe(launcher);
      expect((await lstat(directory)).mtimeMs).toBeGreaterThanOrEqual(before - 1_000);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
