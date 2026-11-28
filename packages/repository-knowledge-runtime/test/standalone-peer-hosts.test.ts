import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, expect, it } from "vitest";

import { CONVERGENCE_HOST_TRAILER } from "../src/convergence-owner-fence.js";
import { standalonePeerHosts } from "../src/convergence-owner-history.js";
import { KNOWLEDGE_OUTPUT_COMMIT_AUTHOR } from "../src/knowledge-output-commit.js";

const execute = promisify(execFile);
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

const self = `sha256:${"a".repeat(64)}`;
const peer = `sha256:${"b".repeat(64)}`;

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await execute("git", ["-C", cwd, ...args])).stdout.trim();
}

async function knowledgeCommit(root: string, host: string, file: string): Promise<void> {
  await writeFile(resolve(root, file), `${file}\n`);
  await git(root, "add", file);
  await git(
    root,
    "-c",
    `user.name=${KNOWLEDGE_OUTPUT_COMMIT_AUTHOR.name}`,
    "-c",
    `user.email=${KNOWLEDGE_OUTPUT_COMMIT_AUTHOR.email}`,
    "commit",
    "-q",
    "-m",
    `docs: ${file}\n\n${CONVERGENCE_HOST_TRAILER}: ${host}`,
  );
}

it("names another host whose knowledge commits reached the branch or its fetched upstream (ADR-0656)", async () => {
  const base = await mkdtemp(resolve(tmpdir(), "lervo-standalone-peers-"));
  directories.push(base);
  const remote = resolve(base, "remote.git");
  await execute("git", ["init", "-q", "--bare", "--initial-branch", "main", remote]);
  const mac = resolve(base, "mac");
  const wsl = resolve(base, "wsl");
  await execute("git", ["clone", "-q", remote, mac]);
  await git(mac, "config", "user.email", "owner@example.invalid");
  await git(mac, "config", "user.name", "Owner");
  await git(mac, "checkout", "-q", "-b", "main");
  await knowledgeCommit(mac, self, "own.md");
  await git(mac, "push", "-q", "-u", "origin", "main");
  const now = Date.now();
  // Only this host's own knowledge commits: no peer.
  expect(await standalonePeerHosts({ repositoryRoot: mac, hostHash: self, now })).toEqual([]);

  // The other host's commit is only fetched, not merged: the upstream still shows it.
  await execute("git", ["clone", "-q", remote, wsl]);
  await knowledgeCommit(wsl, peer, "peer.md");
  await git(wsl, "push", "-q", "origin", "main");
  await git(mac, "fetch", "-q", "origin");
  expect(await standalonePeerHosts({ repositoryRoot: mac, hostHash: self, now })).toEqual([peer]);

  // Commits older than the window no longer count.
  expect(
    await standalonePeerHosts({
      repositoryRoot: mac,
      hostHash: self,
      now: now + 8 * 24 * 60 * 60_000,
    }),
  ).toEqual([]);
});
