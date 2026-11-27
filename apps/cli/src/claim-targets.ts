// What a claim names (Lervo ADE coordination, "What a claim names"): a write's absolute targets as
// repository-relative paths of the conversation's worktree. Runtime and Git-ignored paths claim
// nothing, and a target inside another checkout of the same repository is refused.
import { execFile } from "node:child_process";
import { lstat, readlink, realpath } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve as resolvePath,
  sep,
} from "node:path";

const GIT_TIMEOUT_MS = 1_000;
const MAXIMUM_GIT_OUTPUT_BYTES = 1024 * 1024;
/** The most links one target follows, as the system's own resolution bounds them. */
const MAXIMUM_LINK_HOPS = 40;

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
  /**
   * Targets inside another checkout of the repository that a claim would name there, relative to
   * that checkout.
   */
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
    // Git that exits before reading its input, as `worktree list` can before this line runs, fails
    // the write with EPIPE. Its exit status already answers through the callback above, so the
    // stream error must not escape as an uncaught exception.
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(input ?? "");
  });
}

/**
 * The real path of `path`: its nearest existing ancestor resolved through links, and the rest as
 * given. A dangling link is followed through `readlink`, so a link in the worktree that names a
 * file not yet written in another checkout is judged by where it points. On a case-insensitive
 * filesystem the resolved part takes the spelling on disk, which is the tracked spelling of a
 * tracked file.
 */
async function realTargetPath(path: string): Promise<string> {
  let rest: string[] = [];
  let current = path;
  for (let hops = 0; ;) {
    const real = await realpath(current).catch(() => null);
    if (real !== null) return rest.length === 0 ? real : join(real, ...[...rest].reverse());
    const link = await lstat(current).then(
      (found) => found.isSymbolicLink(),
      () => false,
    );
    if (link && hops < MAXIMUM_LINK_HOPS) {
      hops += 1;
      const target = resolvePath(dirname(current), await readlink(current));
      current = rest.length === 0 ? target : join(target, ...[...rest].reverse());
      rest = [];
      continue;
    }
    if (dirname(current) === current) return path;
    rest.push(basename(current));
    current = dirname(current);
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
 * Targets in other checkouts that a claim would name there. Their runtime paths, `.git`, and the
 * paths Git ignores there claim nothing, as they would in the worktree; such a write is allowed.
 */
async function claimedInOtherCheckouts(
  outside: readonly ClaimTarget[],
  worktree: string,
): Promise<string[]> {
  const checkouts = await otherCheckouts(worktree);
  const byCheckout = new Map<string, ClaimTarget[]>();
  const roots: string[] = [];
  for (const target of outside)
    for (const checkout of checkouts) {
      const within = inside(checkout, target.path);
      if (within === null) continue;
      // A write to another checkout's root would replace all of it.
      if (within === "") roots.push(".");
      else if (!unclaimed(within))
        byCheckout.set(checkout, [
          ...(byCheckout.get(checkout) ?? []),
          { path: within, kind: target.kind },
        ]);
      break;
    }
  const claimed = await Promise.all(
    [...byCheckout].map(([checkout, targets]) => unignoredClaimPaths(checkout, targets)),
  );
  return [...roots, ...claimed.flat()];
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
    targets.map(async (target) => ({ kind: target.kind, path: await realTargetPath(target.path) })),
  );
  const claimed: ClaimTarget[] = [];
  const outside: ClaimTarget[] = [];
  for (const target of located) {
    const path = inside(worktree, target.path);
    if (path === null) outside.push(target);
    else if (!unclaimed(path)) claimed.push({ path, kind: target.kind });
  }
  const otherCheckout =
    outside.length === 0 ? [] : await claimedInOtherCheckouts(outside, worktree);
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
