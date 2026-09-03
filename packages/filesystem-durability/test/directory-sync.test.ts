import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { supportsDirectorySync, syncDirectory } from "../src/index.js";

describe("directory durability", () => {
  it("reports the platforms that support directory fsync", () => {
    expect(supportsDirectorySync("win32")).toBe(false);
    expect(supportsDirectorySync("darwin")).toBe(true);
    expect(supportsDirectorySync("linux")).toBe(true);
  });

  it("does not open a directory handle on Windows", async () => {
    await expect(syncDirectory(resolve("missing-directory"), "win32")).resolves.toBeUndefined();
  });
});
