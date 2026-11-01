import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";

import { measureWorkstreamHeadDistance } from "../src/workstream-repository-head.js";

const execute = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function git(root: string, ...args: string[]) {
  return (
    await execute("git", ["-C", root, "-c", "core.hooksPath=/dev/null", ...args])
  ).stdout.trim();
}

async function commit(root: string, file: string, email: string) {
  await writeFile(resolve(root, file), `${file}\n`);
  await git(root, "add", file);
  await git(
    root,
    "-c",
    "user.name=Author",
    "-c",
    `user.email=${email}`,
    "commit",
    "--quiet",
    "--no-gpg-sign",
    "-m",
    file,
  );
}

it("counts only other authors' commits, never Lervo's own or merge commits", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-workstream-head-"));
  roots.push(root);
  await git(root, "init", "--quiet", "--initial-branch=main");
  await commit(root, "recorded.txt", "owner@example.invalid");
  const recorded = await git(root, "rev-parse", "HEAD");
  await commit(root, "knowledge-1.md", "knowledge@lervo.invalid");
  await commit(root, "knowledge-2.md", "knowledge@lervo.invalid");
  await commit(root, "release.json", "lervo-release[bot]@users.noreply.github.com");
  await commit(root, "owner.txt", "owner@example.invalid");
  await git(root, "checkout", "--quiet", "-b", "feature");
  await commit(root, "feature.txt", "agent@example.invalid");
  await git(root, "checkout", "--quiet", "main");
  await git(
    root,
    "-c",
    "user.name=Owner",
    "-c",
    "user.email=owner@example.invalid",
    "merge",
    "--quiet",
    "--no-ff",
    "--no-gpg-sign",
    "-m",
    "merge",
    "feature",
  );
  expect(
    await measureWorkstreamHeadDistance(root, {
      repositoryHead: { commit: recorded, observedAt: new Date().toISOString() },
    }),
  ).toEqual({
    status: "measured",
    commitsBehind: 2,
  });
});
