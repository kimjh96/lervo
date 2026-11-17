import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({ dependencies: 0, failNext: false }));

// The bundled payload sits beside the built module; under test it is a fixture.
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: ((path: unknown, ...rest: unknown[]) =>
      String(path).endsWith("/node-runtime.js")
        ? Promise.resolve(Buffer.from("payload\n"))
        : (actual.readFile as (...args: unknown[]) => unknown)(
            path,
            ...rest,
          )) as typeof actual.readFile,
  };
});
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

const { describeInstalledNodeLauncher, describeInstalledNodeLauncherOnce } =
  await import("../src/node-fleet-runtime-material.js");

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
});
