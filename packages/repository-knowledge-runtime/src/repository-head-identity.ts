import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Size and modification time of one file, or null when it does not exist. */
export function fileIdentity(path: string): [string, string] | null {
  try {
    const stat = lstatSync(path, { bigint: true });
    return [stat.size.toString(), stat.mtimeNs.toString()];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** The checkout's Git directory; a linked worktree's `.git` file names it. */
function gitDirectory(root: string): string {
  const dotGit = resolve(root, ".git");
  if (lstatSync(dotGit).isDirectory()) return dotGit;
  const named = /^gitdir: (.+)$/mu.exec(readFileSync(dotGit, "utf8"))?.[1]?.trim();
  if (named === undefined) throw new Error("Repository Git directory is unreadable.");
  return resolve(root, named);
}

/** Where shared refs live: the main repository's Git directory for a linked worktree. */
function commonDirectory(gitDir: string): string {
  try {
    return resolve(gitDir, readFileSync(resolve(gitDir, "commondir"), "utf8").trim());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return gitDir;
    throw error;
  }
}

/**
 * ADR-0597: what a commit, checkout, reset or staging changes, read from file metadata with no
 * Git process: HEAD, the ref it names, packed refs, and the index. An edit that touches only the
 * working tree changes none of these; the projection relies on its maximum age for those.
 * Any read failure throws, so the caller treats the key as unknown.
 */
export function repositoryHeadIdentity(root: string): unknown {
  const gitDir = gitDirectory(root);
  const common = commonDirectory(gitDir);
  const head = readFileSync(resolve(gitDir, "HEAD"), "utf8").trim();
  const ref = /^ref: (refs\/\S+)$/u.exec(head)?.[1];
  return {
    head,
    ref: ref === undefined ? null : fileIdentity(resolve(common, ref)),
    packedRefs: fileIdentity(resolve(common, "packed-refs")),
    index: fileIdentity(resolve(gitDir, "index")),
  };
}
