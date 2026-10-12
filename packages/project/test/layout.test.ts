import { posix, win32 } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const roots = [
  "",
  ".",
  "..",
  "/",
  "//",
  "///",
  "/a/../b/",
  "relative/a/..",
  "한글/공백 이름",
  "C:",
  "C:\\",
  "C:relative",
  "C:\\a\\..\\b",
  "\\\\server\\share",
  "\\\\server\\share\\a\\..",
  "//server/share/path",
  "\\\\?\\C:\\a\\..\\b",
  "\\\\?\\UNC\\server\\share\\path",
  "/a\\b/c",
  "C:/a/../b/",
  "a:b",
];

describe.each([
  ["POSIX", posix],
  ["Windows", win32],
] as const)("%s project paths", (_, path) => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("node:path", () => path);
  });
  afterEach(() => {
    vi.doUnmock("node:path");
    vi.resetModules();
  });

  it("matches native resolution for every catalog entry and irregular root", async () => {
    const { resolveProjectPaths, lervoRelativePaths } = await import("../src/layout.js");
    const variedRoots = [...roots];
    const atoms = ["a", "..", ".", "", "한글", "space name", "c:", "\\", "/", ".lervo"];
    let seed = 501;
    for (let i = 0; i < 200; i++) {
      const parts = [];
      for (let j = 0; j < 6; j++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        parts.push(atoms[seed % atoms.length]);
      }
      variedRoots.push(parts.join(i % 2 ? "/" : "\\"));
    }
    for (const root of variedRoots) {
      const repositoryRoot = path.resolve(root);
      expect(resolveProjectPaths(root)).toEqual({
        repositoryRoot,
        ...Object.fromEntries(
          Object.entries(lervoRelativePaths).map(([key, value]) => [
            key === "root" ? "lervoRoot" : key,
            path.resolve(repositoryRoot, value),
          ]),
        ),
      });
    }
  });

  it("keeps native behavior when a catalog value changes or requires normalization", async () => {
    const { resolveProjectPaths, lervoRelativePaths } = await import("../src/layout.js");
    const original = lervoRelativePaths.documents;
    try {
      for (const value of [
        "../escape",
        "a/../b",
        "./same",
        "a//b",
        "/absolute",
        "C:\\absolute",
        "C:relative",
        "\\\\server\\share",
        "nested\\path",
        "",
        "a:b",
        "trailing/",
      ]) {
        Reflect.set(lervoRelativePaths, "documents", value);
        for (const root of roots) {
          expect(resolveProjectPaths(root).documents).toBe(path.resolve(path.resolve(root), value));
        }
      }
      for (const value of [null, 123]) {
        Reflect.set(lervoRelativePaths, "documents", value);
        expect(() => resolveProjectPaths(".")).toThrow(TypeError);
      }
    } finally {
      Reflect.set(lervoRelativePaths, "documents", original);
    }
  });

  it("returns isolated maps and resolves relative roots against the current working directory", async () => {
    let cwd = path.resolve("first");
    vi.doMock("node:path", () => ({
      ...path,
      resolve: (...parts: string[]) => path.resolve(cwd, ...parts),
    }));
    const { resolveProjectPaths } = await import("../src/layout.js");
    const first = resolveProjectPaths("relative");
    first.eventDatabase = "caller mutation";
    expect(resolveProjectPaths("relative").eventDatabase).toBe(
      path.resolve(cwd, "relative/.lervo/data/events.sqlite"),
    );
    cwd = path.resolve("second");
    expect(resolveProjectPaths("relative").repositoryRoot).toBe(path.resolve(cwd, "relative"));
    expect(resolveProjectPaths("relative").repositoryRoot).not.toBe(first.repositoryRoot);
  });
});
