import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);

async function git(root: string, args: string[]): Promise<string | null> {
  try {
    return (await execute("git", ["-C", root, ...args], { maxBuffer: 64 * 1024 })).stdout.trim();
  } catch {
    return null;
  }
}

/**
 * The branch Lervo's own repository effects land on: the remote's default branch as the clone
 * recorded it (`refs/remotes/origin/HEAD`), else a local `main` or `master`. Null when none is
 * known, as in a repository that never had a remote and uses another name.
 */
export async function repositoryBaseBranch(root: string): Promise<string | null> {
  const remote = await git(root, [
    "symbolic-ref",
    "--quiet",
    "--short",
    "refs/remotes/origin/HEAD",
  ]);
  // A dangling `origin/HEAD`, left by a pruned or renamed default branch, names no base.
  if (
    remote !== null &&
    remote.startsWith("origin/") &&
    (await git(root, ["rev-parse", "--verify", "--quiet", `refs/remotes/${remote}`])) !== null
  )
    return remote.slice("origin/".length);
  for (const name of ["main", "master"])
    if ((await git(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${name}`])) !== null)
      return name;
  return null;
}

/**
 * ADR-0610: whether Lervo may write and commit its own effect in this checkout now. Only the base
 * branch qualifies, so an owner working on a feature branch or a detached HEAD never finds Lervo's
 * bytes or commits in that work; the effect waits as Lervo debt and lands once the checkout is on
 * the base branch again. With no known base, the checked-out branch is the only line of work. A
 * directory outside Git, or a repository whose HEAD has no commit yet, has no branch work to
 * protect, so it qualifies; `repositoryCommittable` then tells whether an effect can be committed.
 */
export async function checkoutOnBaseBranch(
  root: string,
): Promise<{ onBase: true } | { onBase: false; branch: string | null; base: string | null }> {
  if (!(await repositoryCommittable(root))) return { onBase: true };
  const branch = await git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const base = await repositoryBaseBranch(root);
  if (branch !== null && (base === null || branch === base)) return { onBase: true };
  return { onBase: false, branch, base };
}

/** Whether the root is a Git work tree whose HEAD names a commit, so an effect can be committed. */
export async function repositoryCommittable(root: string): Promise<boolean> {
  return (await git(root, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"])) !== null;
}

/**
 * The paths a commit would carry: tracked ones and untracked ones Git does not ignore. An ignored
 * path is host-local, such as a provider's local hook file, so writing it leaves no change in Git.
 */
export async function gitVisiblePaths(root: string, paths: readonly string[]): Promise<string[]> {
  if (paths.length === 0 || !(await repositoryCommittable(root))) return [];
  const ignored = await new Promise<Set<string>>((resolveIgnored) => {
    const child = execFile(
      "git",
      ["-C", root, "check-ignore", "-z", "--stdin"],
      { maxBuffer: 1024 * 1024 },
      (_error, stdout) =>
        resolveIgnored(
          new Set(
            String(stdout)
              .split("\0")
              .filter((path) => path !== ""),
          ),
        ),
    );
    child.stdin?.end(`${paths.join("\0")}\0`);
  });
  return paths.filter((path) => !ignored.has(path));
}
