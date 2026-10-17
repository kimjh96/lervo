import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { readRepositoryFile } from "@lervo/context";

import {
  captureRepositorySnapshot,
  changedRepositoryPaths,
  createCachedRepositorySnapshotCapture,
  inspectManagedRepositoryChanges,
  defaultRepositorySnapshotPolicy,
} from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("repository snapshot", () => {
  it("excludes generated Python tool caches without hiding adjacent source", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-snapshot-python-cache-"));
    roots.push(root);
    await mkdir(resolve(root, "services/worker/.mypy_cache"), { recursive: true });
    await mkdir(resolve(root, "services/worker/.pytest_cache"), { recursive: true });
    await mkdir(resolve(root, "services/worker/__pycache__"), { recursive: true });
    await writeFile(resolve(root, "services/worker/main.py"), "print('source')\n");
    for (const name of [".mypy_cache", ".pytest_cache", "__pycache__"]) {
      await writeFile(resolve(root, `services/worker/${name}/cache.json`), "x".repeat(100));
    }

    const snapshot = await captureRepositorySnapshot(root, {
      ...defaultRepositorySnapshotPolicy,
      maxBytes: 50,
    });
    expect(Object.keys(snapshot.files)).toEqual(["services/worker/main.py"]);
  });

  it("skips Git-ignored paths and nested checkouts while keeping tracked files", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-snapshot-git-ignore-"));
    roots.push(root);
    const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args]);
    git("init", "-q");
    await writeFile(resolve(root, ".gitignore"), "out/\n*.log\n");
    await mkdir(resolve(root, "out/generated"), { recursive: true });
    await mkdir(resolve(root, "src"), { recursive: true });
    await mkdir(resolve(root, ".claude/worktrees/feature/src"), { recursive: true });
    await mkdir(resolve(root, "vendored/repo"), { recursive: true });
    await writeFile(resolve(root, "out/tracked.txt"), "tracked\n");
    await writeFile(resolve(root, "out/generated/bundle.js"), "ignored\n");
    await writeFile(resolve(root, "src/main.ts"), "source\n");
    await writeFile(resolve(root, "src/debug.log"), "ignored\n");
    await writeFile(resolve(root, "local-notes.md"), "excluded\n");
    await writeFile(resolve(root, ".git/info/exclude"), "local-notes.md\n");
    await writeFile(resolve(root, ".claude/worktrees/feature/.git"), "gitdir: elsewhere\n");
    await writeFile(resolve(root, ".claude/worktrees/feature/src/main.ts"), "other\n");
    await mkdir(resolve(root, "vendored/repo/.git"));
    await writeFile(resolve(root, "vendored/repo/file.txt"), "other\n");
    git("add", "-f", "out/tracked.txt");

    const snapshot = await captureRepositorySnapshot(root);

    expect(Object.keys(snapshot.files).sort()).toEqual([
      ".gitignore",
      "out/tracked.txt",
      "src/main.ts",
    ]);
  });

  it("detects content, creation and symlink changes while excluding runtime state", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-snapshot-"));
    roots.push(root);
    await mkdir(resolve(root, ".lervo/state"), { recursive: true });
    await mkdir(resolve(root, "src"), { recursive: true });
    await writeFile(resolve(root, "src/a.ts"), "before\n");
    await writeFile(resolve(root, ".lervo/state/events.sqlite"), "before state\n");
    const before = await captureRepositorySnapshot(root);

    await writeFile(resolve(root, "src/a.ts"), "after\n");
    await writeFile(resolve(root, "src/b.ts"), "created\n");
    await symlink("a.ts", resolve(root, "src/link.ts"));
    await writeFile(resolve(root, ".lervo/state/events.sqlite"), "after state\n");
    const after = await captureRepositorySnapshot(root);

    expect(changedRepositoryPaths(before, after)).toEqual(["src/a.ts", "src/b.ts", "src/link.ts"]);
    expect(Object.keys(after.files)).not.toContain(".lervo/state/events.sqlite");
    expect(before.revision).not.toBe(after.revision);
  });

  it("reuses verified file hashes while still detecting metadata-backed content changes", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-snapshot-cache-"));
    roots.push(root);
    await mkdir(resolve(root, "src"), { recursive: true });
    await writeFile(resolve(root, "src/a.ts"), "before\n");
    const reads: string[] = [];
    const capture = createCachedRepositorySnapshotCapture({
      readFile: async (repositoryRoot, path) => {
        reads.push(path);
        return readRepositoryFile(repositoryRoot, path);
      },
    });

    const first = await capture(root);
    const second = await capture(root);
    expect(second).toEqual(first);
    expect(reads).toEqual(["src/a.ts"]);

    await writeFile(resolve(root, "src/a.ts"), "after!\n");
    const third = await capture(root);
    expect(third.revision).not.toBe(first.revision);
    expect(reads).toEqual(["src/a.ts", "src/a.ts"]);
  });

  it("separates cumulative verified changes from unmanaged paths", () => {
    const before = {
      revision: "before",
      files: { "src/existing.ts": "sha256:before" },
    };
    const after = {
      revision: "after",
      files: {
        "src/existing.ts": "sha256:after",
        "src/new.ts": "sha256:new",
        "src/unmanaged.ts": "sha256:unmanaged",
      },
    };

    expect(
      inspectManagedRepositoryChanges({
        before,
        after,
        managedChanges: [
          {
            path: "src/existing.ts",
            beforeHash: "sha256:before",
            afterHash: "sha256:after",
            changeKind: "modified",
          },
          {
            path: "src/new.ts",
            beforeHash: null,
            afterHash: "sha256:new",
            changeKind: "created",
          },
        ],
      }),
    ).toEqual({
      changedPaths: ["src/existing.ts", "src/new.ts", "src/unmanaged.ts"],
      verifiedManagedPaths: ["src/existing.ts", "src/new.ts"],
      invalidManagedPaths: [],
      unmanagedPaths: ["src/unmanaged.ts"],
    });
  });

  it("does not treat mismatched managed evidence as an authorized change", () => {
    expect(
      inspectManagedRepositoryChanges({
        before: { revision: "before", files: {} },
        after: { revision: "after", files: { "src/result.ts": "sha256:actual" } },
        managedChanges: [
          {
            path: "src/result.ts",
            beforeHash: null,
            afterHash: "sha256:reported",
            changeKind: "created",
          },
        ],
      }),
    ).toEqual({
      changedPaths: ["src/result.ts"],
      verifiedManagedPaths: [],
      invalidManagedPaths: ["src/result.ts"],
      unmanagedPaths: ["src/result.ts"],
    });
  });

  it("supports repository-specific exclusions without changing the global default", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-snapshot-policy-"));
    roots.push(root);
    await mkdir(resolve(root, "generated"), { recursive: true });
    await mkdir(resolve(root, "src"), { recursive: true });
    await writeFile(resolve(root, "generated/output.ts"), "ignored\n");
    await writeFile(resolve(root, "src/input.ts"), "included\n");
    await writeFile(resolve(root, "src/local.tmp"), "ignored file\n");

    const snapshot = await captureRepositorySnapshot(root, {
      ...defaultRepositorySnapshotPolicy,
      excludedPaths: [
        ...defaultRepositorySnapshotPolicy.excludedPaths,
        "generated",
        "src/local.tmp",
      ],
    });

    expect(Object.keys(snapshot.files)).toEqual(["src/input.ts"]);
    expect(defaultRepositorySnapshotPolicy.excludedPaths).not.toContain("generated");
  });

  it("excludes common generated dependency and build directories from managed snapshots", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-snapshot-generated-"));
    roots.push(root);
    for (const directory of [
      "node_modules",
      "dist",
      "build",
      "coverage",
      ".next",
      ".turbo",
      ".expo",
      ".gradle",
      ".cxx",
      ".vercel",
      ".cache",
      ".venv",
      "venv",
      "Pods",
      "vendor",
    ]) {
      await mkdir(resolve(root, directory), { recursive: true });
      await writeFile(resolve(root, directory, "large.bin"), "generated bytes\n");
    }
    await mkdir(resolve(root, "generated"));
    await writeFile(resolve(root, "generated/output.ts"), "tracked generated source\n");
    await writeFile(resolve(root, "source.ts"), "tracked source\n");

    const snapshot = await captureRepositorySnapshot(root);

    expect(Object.keys(snapshot.files)).toEqual(["generated/output.ts", "source.ts"]);
    expect(defaultRepositorySnapshotPolicy.maxBytes).toBe(1024 * 1024 * 1024);
  });

  it("does not count nested Python virtual environments against the snapshot byte limit", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-snapshot-venv-"));
    roots.push(root);
    await mkdir(resolve(root, "services/worker/.venv/lib"), { recursive: true });
    await writeFile(resolve(root, "services/worker/.venv/lib/dependency.bin"), "x".repeat(128));
    await writeFile(resolve(root, "services/worker/source.py"), "source\n");

    const snapshot = await captureRepositorySnapshot(root, {
      ...defaultRepositorySnapshotPolicy,
      maxBytes: 16,
    });

    expect(Object.keys(snapshot.files)).toEqual(["services/worker/source.py"]);
  });

  it("fails safely when repository limits or exclusions are invalid", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-snapshot-limits-"));
    roots.push(root);
    await writeFile(resolve(root, "a.ts"), "a\n");
    await writeFile(resolve(root, "b.ts"), "b\n");

    await expect(
      captureRepositorySnapshot(root, {
        ...defaultRepositorySnapshotPolicy,
        maxEntries: 1,
      }),
    ).rejects.toThrow("file-count limit");
    await expect(
      captureRepositorySnapshot(root, {
        ...defaultRepositorySnapshotPolicy,
        excludedPaths: ["../outside"],
      }),
    ).rejects.toThrow("policy is invalid");
  });
});
