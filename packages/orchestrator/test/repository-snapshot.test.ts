import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  captureRepositorySnapshot,
  changedRepositoryPaths,
  defaultRepositorySnapshotPolicy,
} from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("repository snapshot", () => {
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

    expect(changedRepositoryPaths(before, after)).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/link.ts",
    ]);
    expect(Object.keys(after.files)).not.toContain(".lervo/state/events.sqlite");
    expect(before.revision).not.toBe(after.revision);
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
    ).rejects.toThrow("파일 수 제한");
    await expect(
      captureRepositorySnapshot(root, {
        ...defaultRepositorySnapshotPolicy,
        excludedPaths: ["../outside"],
      }),
    ).rejects.toThrow("정책이 유효하지 않습니다");
  });
});
