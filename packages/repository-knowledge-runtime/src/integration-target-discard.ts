import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { LERVO_KNOWLEDGE_COMMITTER_EMAIL } from "./integration-target-absorption.js";

const execute = promisify(execFile);

async function git(root: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await execute("git", ["-C", root, ...args], {
    maxBuffer: 16 * 1024 * 1024,
    ...(env === undefined ? {} : { env: { ...process.env, ...env } }),
  });
  return stdout.trim();
}

/** Working-tree bytes of a regular file; any other entry, or none, is absent. */
export async function workingTreeHash(root: string, path: string): Promise<string | null> {
  const file = resolve(root, path);
  const stat = await lstat(file).catch(() => null);
  if (stat === null || !stat.isFile()) return null;
  return `sha256:${createHash("sha256")
    .update(await readFile(file))
    .digest("hex")}`;
}

/**
 * ADR-0530: when the integration ref is strictly ahead of `HEAD`, each ref-only path is normally an
 * integrated draft that root apply wrote into the working tree and the developer has yet to commit.
 * A path whose working-tree bytes no longer equal its integrated draft was discarded or rewritten
 * on the working branch, which is authoritative. Those paths return to `HEAD`'s committed version in
 * a Lervo commit on top of the ref; drafts still awaiting their commit stay. Only exact integrated
 * drafts move, so an owner commit on the ref is never touched.
 */
export async function restoreDiscardedIntegratedDrafts(input: {
  repositoryRoot: string;
  ref: string;
  target: string;
  head: string;
  blobHash: (commit: string, path: string) => Promise<string | null>;
  integrated: (path: string, contentHash: string) => boolean;
}): Promise<string[]> {
  const root = input.repositoryRoot;
  const changed = (await git(root, ["diff", "--name-only", "-z", input.head, input.target]))
    .split("\0")
    .filter(Boolean);
  const discarded: string[] = [];
  for (const path of changed) {
    const draft = await input.blobHash(input.target, path);
    if (draft === null || !input.integrated(path, draft)) continue;
    if ((await workingTreeHash(root, path)) !== draft) discarded.push(path);
  }
  if (discarded.length === 0) return [];
  const directory = await mkdtemp(join(tmpdir(), "lervo-integration-index-"));
  try {
    const env = { GIT_INDEX_FILE: join(directory, "index") };
    await git(root, ["read-tree", input.target], env);
    for (const path of discarded) {
      const entry = await git(root, ["ls-tree", "-z", input.head, "--", path]);
      if (entry === "") {
        await git(root, ["update-index", "--force-remove", "--", path], env);
        continue;
      }
      const [meta] = entry.split("\t");
      const [mode, , object] = meta!.split(" ");
      await git(root, ["update-index", "--add", "--cacheinfo", `${mode},${object},${path}`], env);
    }
    const tree = await git(root, ["write-tree"], env);
    const commit = await git(root, [
      "-c",
      "user.name=Lervo Knowledge Worker",
      "-c",
      `user.email=${LERVO_KNOWLEDGE_COMMITTER_EMAIL}`,
      "commit-tree",
      tree,
      "-p",
      input.target,
      "-m",
      "Return integrated drafts the working branch discarded to its committed bytes",
    ]);
    await git(root, ["update-ref", input.ref, commit, input.target]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  return discarded;
}
