// What a claim names (Lervo ADE coordination, "What a claim names"): a write's absolute targets as
// repository-relative paths of the conversation's worktree. Runtime and Git-ignored paths claim
// nothing, and a target inside another checkout of the same repository is refused.
import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";

const GIT_TIMEOUT_MS = 1_000;
const MAXIMUM_GIT_OUTPUT_BYTES = 1024 * 1024;

/** Lervo's runtime paths, which no sealed change may contain, and Git's own directory. */
const UNCLAIMED_PREFIXES = [".lervo/state", ".lervo/data", ".lervo/run", ".git"];

export interface ClaimTarget {
  readonly path: string;
  readonly kind: "file" | "directory";
}

/** Where a write's targets sit, relative to the checkout that holds each. */
export interface LocatedClaimTargets {
  /** Targets inside the conversation's worktree that a claim may name, repository-relative. */
  readonly inside: readonly ClaimTarget[];
  /** Targets inside another checkout of the repository, relative to that checkout. */
  readonly otherCheckout: readonly string[];
}

/** The process environment without variables that would point Git at another repository. */
function gitEnvironment(): NodeJS.ProcessEnv {
  const { GIT_DIR: _dir, GIT_WORK_TREE: _tree, GIT_COMMON_DIR: _common, ...rest } = process.env;
  return rest;
}

function git(worktree: string, args: readonly string[], input?: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = execFile(
      "git",
      ["-C", worktree, ...args],
      {
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: MAXIMUM_GIT_OUTPUT_BYTES,
        env: gitEnvironment(),
        encoding: "utf8",
      },
      (error, stdout) => {
        // `git check-ignore` exits 1 when no path is ignored, which is an answer, not a failure.
        const code = (error as { code?: unknown } | null)?.code;
        resolve(error === null || code === 1 ? stdout : null);
      },
    );
    child.stdin?.end(input ?? "");
  });
}

/**
 * The real path of `path`: its nearest existing ancestor resolved through links, and the rest as
 * given. On a case-insensitive filesystem the resolved part takes the spelling on disk, which is
 * the tracked spelling of a tracked file.
 */
async function realTargetPath(path: string): Promise<string> {
  const rest: string[] = [];
  for (let current = path; ; current = dirname(current)) {
    const real = await realpath(current).catch(() => null);
    if (real !== null) return rest.length === 0 ? real : join(real, ...rest.reverse());
    if (dirname(current) === current) return path;
    rest.push(basename(current));
  }
}

/** `path` relative to `root` with forward slashes, or null when it is outside `root`. */
function inside(root: string, path: string): string | null {
  const relativePath = relative(root, path);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath))
    return null;
  return relativePath.split(sep).join("/");
}

function unclaimed(path: string): boolean {
  return (
    path === "" ||
    UNCLAIMED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
  );
}

/** The real paths of every other checkout of the worktree's repository, deepest first. */
async function otherCheckouts(worktree: string): Promise<string[]> {
  const listed = await git(worktree, ["worktree", "list", "--porcelain", "-z"]);
  if (listed === null) return [];
  const paths = listed
    .split("\0")
    .filter((field) => field.startsWith("worktree "))
    .map((field) => field.slice("worktree ".length));
  const real = await Promise.all(paths.map((path) => realpath(path).catch(() => null)));
  return real
    .filter((path): path is string => path !== null && path !== worktree)
    .sort((left, right) => right.length - left.length);
}

/**
 * Locates a write's absolute targets. A target outside the worktree is looked up among the other
 * checkouts only when there is one, so a write inside the worktree spawns no Git. The worktree
 * itself, Lervo's runtime paths, `.git`, and a target outside every checkout claim nothing: a
 * claim never names `.`, which would block every other agent.
 */
export async function locateClaimTargets(
  targets: readonly ClaimTarget[],
  worktree: string,
): Promise<LocatedClaimTargets> {
  const located = await Promise.all(
    targets.map(async (target) => ({ kind: target.kind, real: await realTargetPath(target.path) })),
  );
  const claimed: ClaimTarget[] = [];
  const outside: string[] = [];
  for (const target of located) {
    const path = inside(worktree, target.real);
    if (path === null) outside.push(target.real);
    else if (!unclaimed(path)) claimed.push({ path, kind: target.kind });
  }
  const otherCheckout: string[] = [];
  if (outside.length !== 0) {
    const checkouts = await otherCheckouts(worktree);
    for (const path of outside)
      for (const checkout of checkouts) {
        const within = inside(checkout, path);
        if (within === null) continue;
        otherCheckout.push(within === "" ? "." : within);
        break;
      }
  }
  return { inside: claimed, otherCheckout };
}

/**
 * The targets Git does not ignore, in one `git check-ignore`. A directory is asked with a trailing
 * `/`, so a directory pattern matches a directory a command is about to create. A failed check
 * keeps every target: claiming an ignored path refuses nothing another holder does not hold.
 */
export async function unignoredClaimPaths(
  worktree: string,
  targets: readonly ClaimTarget[],
): Promise<string[]> {
  if (targets.length === 0) return [];
  const asked = targets.map((target) =>
    target.kind === "directory" ? `${target.path}/` : target.path,
  );
  const ignored = await git(worktree, ["check-ignore", "-z", "--stdin"], `${asked.join("\0")}\0`);
  const skipped = new Set(
    ignored === null ? [] : ignored.split("\0").filter((path) => path !== ""),
  );
  return targets.filter((_, index) => !skipped.has(asked[index]!)).map((target) => target.path);
}
