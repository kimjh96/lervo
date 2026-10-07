import { describe, expect, it } from "vitest";

import { assertNodeRuntimeDependencies } from "../src/runtime-dependency-preflight.js";

describe("Node runtime dependency preflight", () => {
  it("accepts an importable SDK without starting it", async () => {
    const startup = () => {
      throw new Error("must not start a provider");
    };
    await expect(assertNodeRuntimeDependencies(async () => ({ startup }))).resolves.toBeUndefined();
  });

  it("rejects absent or incompatible SDKs with one path-free failure code", async () => {
    for (const load of [
      async () => ({}),
      async () => {
        throw new Error("private installation path");
      },
    ]) {
      await expect(assertNodeRuntimeDependencies(load)).rejects.toMatchObject({
        code: "runtime_dependency_unavailable",
      });
      await expect(assertNodeRuntimeDependencies(load)).rejects.not.toHaveProperty("cause");
    }
  });
});
