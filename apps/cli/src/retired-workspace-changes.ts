// The copy of a workspace's uncommitted changes that retiring keeps when its owner removes the
// workspace with them (Lervo ADE sessions, "Retiring a workspace"). Each copy is one commit under
// `refs/lervo/retired-changes/<workspace ID>`, parented on the workspace's HEAD, so
// `git worktree add --detach <path> <ref>` brings the changes back. The copies are bounded:
// retiring prunes any older than 14 days and all but the newest 10, never the one it just wrote,
// and Git's own garbage collection then drops their objects. Lervo pushes only branches, so the
// copies stay in the repository's local refs.
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

export const RETIRED_CHANGES_PREFIX = "refs/lervo/retired-changes/";
/** How many copies a repository keeps, newest first. */
export const RETIRED_CHANGES_KEPT = 10;
/** How long a copy lasts. */
export const RETIRED_CHANGES_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;

/** Lervo's own state in a checkout, which the copy leaves out as the changed paths do. */
const LERVO_STATE = [".lervo/state", ".lervo/data", ".lervo/run"];

/** The identity of the copy's commit, so a host without a Git identity can still keep one. */
const IDENTITY = {
  GIT_AUTHOR_NAME: "Lervo",
  GIT_AUTHOR_EMAIL: "lervo@localhost",
  GIT_COMMITTER_NAME: "Lervo",
  GIT_COMMITTER_EMAIL: "lervo@localhost",
};

async function git(
  directory: string,
  arguments_: readonly string[],
  environment: Record<string, string> = {},
): Promise<string> {
  // No inherited Git variable points this at another repository or index.
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
  );
  const { stdout } = await execute("git", ["-C", directory, ...arguments_], {
    encoding: "utf8",
    env: { ...inherited, GIT_OPTIONAL_LOCKS: "0", ...environment },
  });
  return stdout.trim();
}

/**
 * A nested repository or submodule with work of its own: a copy holds only its gitlink, never its
 * objects or uncommitted files, so removing the worktree would lose that work.
 */
export class NestedRepositoryChanges extends Error {
  constructor(readonly paths: readonly string[]) {
    super(`Nested repositories hold work a copy cannot keep: ${paths.join(", ")}`);
  }
}

/** The gitlinks of a tree listing, by path. */
function gitlinks(listing: string): Map<string, string> {
  const links = new Map<string, string>();
  for (const line of listing.split("\n")) {
    const match = /^160000 commit ([0-9a-f]+)\t(.+)$/u.exec(line);
    if (match !== null) links.set(match[2]!, match[1]!);
  }
  return links;
}

/**
 * The nested repositories whose work the copy would lose: a gitlink the workspace's HEAD lacks or
 * records at another commit, such as an embedded repository or a submodule moved to new commits,
 * and a submodule with uncommitted changes of its own.
 */
async function nestedWork(worktree: string, tree: string): Promise<string[]> {
  const kept = gitlinks(await git(worktree, ["ls-tree", "-r", tree]));
  if (kept.size === 0) return [];
  const head = gitlinks(await git(worktree, ["ls-tree", "-r", "HEAD"]));
  const lost: string[] = [];
  for (const [path, commit] of kept) {
    if (head.get(path) !== commit) lost.push(path);
    else if ((await git(join(worktree, path), ["status", "--porcelain"]).catch(() => "")) !== "")
      lost.push(path);
  }
  return lost;
}

/** A kept copy: its ref, and the command that brings the changes back where they were. */
export interface KeptChanges {
  readonly ref: string;
  readonly restore: string;
}

const quoted = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;

/**
 * Commits the worktree's tracked changes and the untracked files Git does not ignore, except
 * Lervo's own state, through a separate index so the worktree's own index never changes, and
 * points the workspace's ref at it.
 */
export async function keepRetiredChanges(
  root: string,
  worktree: string,
  workspaceId: string,
  now: Date = new Date(),
): Promise<KeptChanges> {
  const scratch = await mkdtemp(join(tmpdir(), "lervo-retire-"));
  try {
    const index = { GIT_INDEX_FILE: join(scratch, "index") };
    await git(worktree, ["read-tree", "HEAD"], index);
    await git(worktree, ["add", "--all"], index);
    // Taken out after adding, since a pathspec that names an ignored path fails `git add`.
    await git(
      worktree,
      ["rm", "-r", "--cached", "--quiet", "--ignore-unmatch", "--", ...LERVO_STATE],
      index,
    );
    const tree = await git(worktree, ["write-tree"], index);
    const nested = await nestedWork(worktree, tree);
    if (nested.length > 0) throw new NestedRepositoryChanges(nested);
    const commit = await git(
      worktree,
      ["commit-tree", tree, "-p", "HEAD", "-m", `Uncommitted changes of ${workspaceId}`],
      IDENTITY,
    );
    const ref = `${RETIRED_CHANGES_PREFIX}${workspaceId}`;
    await git(root, ["update-ref", ref, commit]);
    await pruneRetiredChanges(root, now, ref);
    return {
      ref,
      restore: `git -C ${quoted(root)} worktree add --detach ${quoted(worktree)} ${ref}`,
    };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/**
 * The copies to delete: older than the lifetime, or the oldest beyond the newest kept, by commit
 * time. `keep`, the copy just written, counts among the newest and is never deleted.
 */
export function expiredRetiredChanges(
  copies: readonly { ref: string; committedAtMs: number }[],
  now: Date,
  keep?: string,
): string[] {
  const newest = [...copies].sort(
    (a, b) => Number(b.ref === keep) - Number(a.ref === keep) || b.committedAtMs - a.committedAtMs,
  );
  return newest
    .filter(
      (copy, rank) =>
        copy.ref !== keep &&
        (rank >= RETIRED_CHANGES_KEPT ||
          now.getTime() - copy.committedAtMs > RETIRED_CHANGES_LIFETIME_MS),
    )
    .map((copy) => copy.ref);
}

/** Deletes the copies past their bound, never `keep`. */
export async function pruneRetiredChanges(
  root: string,
  now: Date = new Date(),
  keep?: string,
): Promise<void> {
  const listed = await git(root, [
    "for-each-ref",
    "--format=%(refname) %(committerdate:unix)",
    RETIRED_CHANGES_PREFIX,
  ]);
  const copies = listed
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const [ref, seconds] = line.split(" ");
      return { ref: ref!, committedAtMs: Number(seconds) * 1000 };
    });
  for (const ref of expiredRetiredChanges(copies, now, keep))
    await git(root, ["update-ref", "-d", ref]);
}
