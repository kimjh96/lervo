import { expect, it } from "vitest";
import { distributionEntriesEqual } from "../lib/runtime-distribution-inventory.mjs";

const file = Object.freeze({
  path: "dist/bin.js",
  kind: "file",
  size: 3,
  mode: 0o755,
  sha256: `sha256:${"a".repeat(64)}`,
});

it("compares Windows writable and read-only files without inventing POSIX permissions", () => {
  expect(distributionEntriesEqual([{ ...file, mode: 0o666 }], [file], "win32")).toBe(true);
  expect(
    distributionEntriesEqual([{ ...file, mode: 0o444 }], [{ ...file, mode: 0o555 }], "win32"),
  ).toBe(true);
  expect(distributionEntriesEqual([{ ...file, mode: 0o444 }], [file], "win32")).toBe(false);
  expect(distributionEntriesEqual([file], [{ ...file, mode: 0o444 }], "win32")).toBe(false);
  expect(file.mode).toBe(0o755);
});

it.each(["darwin", "linux"])("retains exact POSIX permissions on %s", (platform) => {
  expect(distributionEntriesEqual([file], [file], platform)).toBe(true);
  for (const mode of [0o644, 0o777, 0o555])
    expect(distributionEntriesEqual([{ ...file, mode }], [file], platform)).toBe(false);
});

it("still rejects changed Windows content, path, kind, link target and inventory", () => {
  for (const change of [
    { sha256: `sha256:${"b".repeat(64)}` },
    { size: 4 },
    { path: "dist/other.js" },
    { kind: "symlink", target: "other.js" },
    { unexpected: true },
  ])
    expect(distributionEntriesEqual([{ ...file, ...change }], [file], "win32")).toBe(false);
  expect(distributionEntriesEqual([], [file], "win32")).toBe(false);
  expect(distributionEntriesEqual([file, file], [file], "win32")).toBe(false);
  const link = { kind: "symlink", path: "bin/lervo", target: "../dist/bin.js" };
  expect(distributionEntriesEqual([{ ...link, target: "../other.js" }], [link], "win32")).toBe(
    false,
  );
});
