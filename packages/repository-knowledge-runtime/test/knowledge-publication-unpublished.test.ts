import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadOrCreateConvergenceOwnerHost } from "../src/convergence-owner-host.js";
import { KNOWLEDGE_PUBLICATION_HISTORY_PATH } from "../src/knowledge-publication-history.js";
import { unpublishedKnowledgeCommits } from "../src/knowledge-publication-unpublished.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

const knowledge = {
  ...process.env,
  GIT_AUTHOR_NAME: "Lervo Knowledge",
  GIT_AUTHOR_EMAIL: "knowledge@lervo.invalid",
  GIT_COMMITTER_NAME: "Lervo Knowledge",
  GIT_COMMITTER_EMAIL: "knowledge@lervo.invalid",
};

/** A clone whose `main` holds three knowledge commits its upstream lacks. */
async function checkout() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "lervo-unpublished-")));
  roots.push(base);
  const remote = join(base, "remote.git");
  const root = join(base, "repo");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
  execFileSync("git", ["clone", "-q", remote, root], { stdio: "ignore" });
  git(root, "config", "user.email", "test@example.invalid");
  git(root, "config", "user.name", "Test");
  await writeFile(join(root, "README.md"), "hello\n");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "first");
  git(root, "push", "-q", "-u", "origin", "main");
  const commits: string[] = [];
  for (const name of ["a", "b", "c"]) {
    await writeFile(join(root, `${name}.md`), `${name}\n`);
    git(root, "add", `${name}.md`);
    execFileSync("git", ["-C", root, "commit", "-q", "-m", `apply ${name}`], { env: knowledge });
    commits.push(git(root, "rev-parse", "HEAD"));
  }
  return { root, commits };
}

async function writeCache(root: string, hostHash: string, published: string[], declined: string[]) {
  await writeFile(
    join(root, KNOWLEDGE_PUBLICATION_HISTORY_PATH),
    JSON.stringify({
      schemaVersion: 2,
      repository: "owner/repo",
      history: { through: null, pullRequests: [], pullPatches: {} },
      local: {
        hostHash,
        base: git(root, "rev-parse", "origin/main"),
        head: git(root, "rev-parse", "HEAD"),
        published,
        declined: [{ pullRequestNumber: 7, commits: declined }],
        lastMerged: null,
      },
    }),
  );
}

describe("the knowledge commits the resident has not published", () => {
  it("leave out what a merged publication carried and what a person declined", async () => {
    const { root, commits } = await checkout();
    const [a, b, c] = commits as [string, string, string];
    expect(
      await unpublishedKnowledgeCommits(
        root,
        { remote: "origin", branch: "main" },
        "refs/heads/main",
      ),
    ).toEqual(commits);
    const host = await loadOrCreateConvergenceOwnerHost(root);
    await writeCache(root, host.hostHash, [a], [b]);
    expect(
      await unpublishedKnowledgeCommits(
        root,
        { remote: "origin", branch: "main" },
        "refs/heads/main",
      ),
    ).toEqual([c]);
  });

  it("trust the cache only for the host that derived it", async () => {
    const { root, commits } = await checkout();
    await loadOrCreateConvergenceOwnerHost(root);
    await writeCache(root, `sha256:${"0".repeat(64)}`, [commits[0]!], [commits[1]!]);
    expect(
      await unpublishedKnowledgeCommits(
        root,
        { remote: "origin", branch: "main" },
        "refs/heads/main",
      ),
    ).toEqual(commits);
  });
});
