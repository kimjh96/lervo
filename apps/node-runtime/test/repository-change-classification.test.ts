import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyRepositoryChange,
  createRepositoryChangeScope,
} from "../src/repository-change-classification.js";

const root = join("/", "repository");
const gitDirectory = join(root, ".git");
const scopeInput = {
  directories: [
    root,
    join(root, "source"),
    join(root, "source/nested"),
    join(root, ".lervo/state"),
    gitDirectory,
    join(gitDirectory, "refs"),
    join(gitDirectory, "refs/heads"),
    join(gitDirectory, "refs/heads/x"),
    // Git under core.ignoreCase can record a directory in another case than the disk reports.
    join(root, "Docs/Guide"),
  ],
  state: join(root, ".lervo/state"),
  gitRoots: [gitDirectory],
};
const exact = createRepositoryChangeScope({ ...scopeInput, foldCase: false });
const folded = createRepositoryChangeScope({ ...scopeInput, foldCase: true });
const classify = (filename: string | undefined, event = "change", base = root, scope = exact) =>
  classifyRepositoryChange(event, base, filename, scope);

describe("repository change classification", () => {
  it("notifies for direct children of tracked directories only", () => {
    expect(classify("source/nested/file.ts")).toEqual({ notify: true, refresh: false });
    expect(classify("file.ts", "change", join(root, "source/nested"))).toEqual({
      notify: true,
      refresh: false,
    });
    expect(classify("node_modules/package/index.js")).toEqual({ notify: false, refresh: false });
    expect(classify("cache/nested/file")).toEqual({ notify: false, refresh: false });
  });

  it("refreshes the directory set after renames and ignore-rule edits", () => {
    expect(classify("source/created", "rename")).toEqual({ notify: true, refresh: true });
    expect(classify("source/.gitignore")).toEqual({ notify: true, refresh: true });
    expect(classify("cache/created", "rename")).toEqual({ notify: false, refresh: false });
  });

  it("admits only the replica request inside runtime state", () => {
    expect(classify(".lervo/state/other.json")).toEqual({ notify: false, refresh: false });
    expect(classify(".lervo/state/repository-replica-request.json", "rename")).toEqual({
      notify: true,
      refresh: true,
    });
  });

  it("admits Git coordinates and branch refs but not object storage", () => {
    for (const name of ["HEAD", "index", "packed-refs", "config"])
      expect(classify(`.git/${name}`).notify).toBe(true);
    expect(classify("refs/heads/x/y", "rename", gitDirectory).notify).toBe(true);
    expect(classify(".git/objects/ab/cdef").notify).toBe(false);
    expect(classify(".git/index.lock").notify).toBe(false);
    expect(classify(".git/info/exclude").notify).toBe(false);
  });

  it("notifies and refreshes conservatively when the native event names no file", () => {
    expect(classify(undefined)).toEqual({ notify: true, refresh: true });
    expect(classify("")).toEqual({ notify: true, refresh: true });
  });

  it("treats an event naming the watched base itself as a change", () => {
    // Windows reports deletion of the watched directory with its absolute path.
    expect(classify(root)).toEqual({ notify: true, refresh: true });
    expect(classify(join(root, "source"), "rename", join(root, "source"))).toEqual({
      notify: true,
      refresh: true,
    });
  });

  it("compares paths case-insensitively only when the host folds case", () => {
    expect(classify("docs/guide/page.md").notify).toBe(false);
    expect(classify("docs/guide/page.md", "change", root, folded).notify).toBe(true);
    expect(classify("SOURCE/Nested/file.ts", "change", root, folded).notify).toBe(true);
    expect(
      classify(".LERVO/State/repository-replica-request.json", "change", root, folded),
    ).toEqual({ notify: true, refresh: false });
    expect(classify(".lervo/STATE/other.json", "change", root, folded).notify).toBe(false);
    expect(classify(".GIT/HEAD", "change", root, folded).notify).toBe(true);
    expect(classify(".GIT/objects/ab/cdef", "change", root, folded).notify).toBe(false);
    expect(classify("CACHE/file", "change", root, folded).notify).toBe(false);
  });
});
