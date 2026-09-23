import { execFile } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  compareRepositoryWork,
  observeRepositoryWork,
} from "../src/repository-work-observation.js";
import { readRepositoryWorkReviewSnapshot } from "../src/repository-work-review-snapshot.js";
import { prepareRepositoryWorkSourceManifest } from "../src/repository-work-source-manifest.js";

const execute = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-review-source-"));
  roots.push(root);
  await execute("git", ["init", "-b", "main"], { cwd: root });
  await execute("git", ["config", "user.email", "lervo-test@example.invalid"], { cwd: root });
  await execute("git", ["config", "user.name", "Lervo Test"], { cwd: root });
  await writeFile(resolve(root, "README.md"), "before\n");
  await execute("git", ["add", "README.md"], { cwd: root });
  await execute("git", ["commit", "-m", "initial"], { cwd: root });
  return root;
}

async function changedManifest(root: string, change: () => Promise<void>) {
  const before = await observeRepositoryWork(root);
  await change();
  const after = await observeRepositoryWork(root);
  const difference = await compareRepositoryWork({ repositoryRoot: root, before, after });
  return prepareRepositoryWorkSourceManifest({ before, after, change: difference }).manifest;
}

describe("repository work review snapshot", () => {
  it("captures exact committed-before and dirty-after bytes without writing source content", async () => {
    const root = await repository();
    const manifest = await changedManifest(root, () =>
      writeFile(resolve(root, "README.md"), "after\n"),
    );
    const snapshot = await readRepositoryWorkReviewSnapshot({ repositoryRoot: root, manifest });
    expect(snapshot).toMatchObject({
      status: "ready_for_review",
      changedPathCount: 1,
      totalByteCount: 13,
      paths: [{ path: "README.md", before: { kind: "file" }, after: { kind: "file" } }],
    });
    if (snapshot.status !== "ready_for_review") throw new Error("Expected exact review bytes.");
    expect(
      Buffer.from(
        snapshot.paths[0]!.before.kind === "file" ? snapshot.paths[0]!.before.content : [],
      ).toString(),
    ).toBe("before\n");
    expect(
      Buffer.from(
        snapshot.paths[0]!.after.kind === "file" ? snapshot.paths[0]!.after.content : [],
      ).toString(),
    ).toBe("after\n");

    await writeFile(resolve(root, "README.md"), "later\n");
    expect(await readRepositoryWorkReviewSnapshot({ repositoryRoot: root, manifest })).toEqual({
      status: "stale",
      changedPathCount: 1,
      reasonCode: "source_bytes_changed",
    });
  });

  it("reads a pinned Git-tree after coordinate across unrelated later commits", async () => {
    const root = await repository();
    const manifest = await changedManifest(root, async () => {
      await writeFile(resolve(root, "README.md"), "after\n");
      await execute("git", ["add", "README.md"], { cwd: root });
      await execute("git", ["commit", "-m", "change readme"], { cwd: root });
    });
    await writeFile(resolve(root, "OTHER.md"), "unrelated\n");
    await execute("git", ["add", "OTHER.md"], { cwd: root });
    await execute("git", ["commit", "-m", "unrelated"], { cwd: root });
    const snapshot = await readRepositoryWorkReviewSnapshot({ repositoryRoot: root, manifest });
    expect(snapshot.status).toBe("ready_for_review");
    if (snapshot.status !== "ready_for_review") return;
    const after = snapshot.paths[0]!.after;
    expect(after.kind === "file" ? Buffer.from(after.content).toString() : null).toBe("after\n");
  });

  it("does not invent unreconstructable dirty-before content", async () => {
    const root = await repository();
    await writeFile(resolve(root, "README.md"), "dirty before\n");
    const manifest = await changedManifest(root, () =>
      writeFile(resolve(root, "README.md"), "dirty after\n"),
    );
    expect(await readRepositoryWorkReviewSnapshot({ repositoryRoot: root, manifest })).toEqual({
      status: "needs_review",
      changedPathCount: 1,
      reasonCode: "before_bytes_unavailable",
    });
  });

  it("captures a deleted path as missing rather than reading current unrelated content", async () => {
    const root = await repository();
    const manifest = await changedManifest(root, () => rm(resolve(root, "README.md")));
    const snapshot = await readRepositoryWorkReviewSnapshot({ repositoryRoot: root, manifest });
    expect(snapshot).toMatchObject({
      status: "ready_for_review",
      paths: [{ path: "README.md", before: { kind: "file" }, after: { kind: "missing" } }],
    });
  });

  it("captures a symlink target without following it", async () => {
    const root = await repository();
    const manifest = await changedManifest(root, () =>
      symlink("../outside-secret", resolve(root, "LINK")),
    );
    const snapshot = await readRepositoryWorkReviewSnapshot({ repositoryRoot: root, manifest });
    expect(snapshot).toMatchObject({
      status: "ready_for_review",
      paths: [{ path: "LINK", before: { kind: "missing" }, after: { kind: "link" } }],
    });
    if (snapshot.status !== "ready_for_review") return;
    const after = snapshot.paths[0]!.after;
    expect(after.kind === "link" ? Buffer.from(after.content).toString() : null).toBe(
      "../outside-secret",
    );
  });

  it("rejects source bytes beyond the review bound without truncation", async () => {
    const root = await repository();
    const manifest = await changedManifest(root, () =>
      writeFile(resolve(root, "README.md"), "after\n"),
    );
    await expect(
      readRepositoryWorkReviewSnapshot({ repositoryRoot: root, manifest, maximumBytes: 12 }),
    ).rejects.toMatchObject({ code: "review_source_limit_exceeded" });
  });
});
