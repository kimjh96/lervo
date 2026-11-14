import { execFile } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { ProjectStorageError } from "./types.js";

const execute = promisify(execFile);
const MAXIMUM_REMEMBERED_REPOSITORIES = 64;

export interface GitCoordinates {
  topLevel: string;
  commonDirectory: string;
}

interface RememberedGitCoordinates {
  coordinates: GitCoordinates;
  inputs: string;
}

/**
 * Every workforce read resolves these coordinates, and each Git process forks the whole
 * resident. A plain checkout's answer depends only on the observed inputs below, so it is
 * reused while they are unchanged; linked worktrees and unowned checkouts always ask Git.
 */
const remembered = new Map<string, RememberedGitCoordinates>();

function invalid(message: string, cause?: unknown): never {
  throw new ProjectStorageError(
    "coordination_home_invalid",
    message,
    cause === undefined ? undefined : { cause },
  );
}

async function observeGit(root: string): Promise<GitCoordinates | null> {
  try {
    const arguments_ = [
      "-C",
      root,
      "rev-parse",
      "--path-format=absolute",
      "--show-toplevel",
      "--git-common-dir",
    ];
    const { stdout } = await execute("git", arguments_, { encoding: "utf8", maxBuffer: 16_384 });
    const values = stdout.trim().split(/\r?\n/u);
    if (
      values.length !== 2 ||
      values.some((value) => value.trim().length === 0 || value.includes("\0"))
    )
      invalid("Git returned an invalid repository coordinate.");
    return { topLevel: resolve(values[0]!.trim()), commonDirectory: resolve(values[1]!.trim()) };
  } catch (error) {
    if (error instanceof ProjectStorageError) throw error;
    if (
      typeof (error as { stdout?: unknown }).stdout === "string" &&
      (error as { stdout: string }).stdout.trim().length > 0
    )
      invalid("Git returned incomplete repository coordinates.", error);
    return null;
  }
}

/** Exact identity of a configuration file Git may read; absence is a distinct valid state. */
async function configurationIdentity(path: string): Promise<string | null> {
  try {
    const info = await lstat(path, { bigint: true });
    return [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(":");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "absent" : null;
  }
}

/**
 * Git accepts a directory as a repository only with a valid HEAD and real objects and refs
 * directories. Validity, not identity, is required: commits rewrite HEAD without moving it.
 */
async function acceptedGitDirectory(gitDirectory: string): Promise<boolean> {
  try {
    const [head, objects, refs] = await Promise.all(
      ["HEAD", "objects", "refs"].map((name) => lstat(resolve(gitDirectory, name))),
    );
    if (
      !head!.isFile() ||
      head!.size > 4_096 ||
      [objects!, refs!].some((info) => !info.isDirectory() || info.isSymbolicLink())
    )
      return false;
    return /^(?:ref: refs\/\S+|[0-9a-f]{40}|[0-9a-f]{64})\n?$/u.test(
      await readFile(resolve(gitDirectory, "HEAD"), "utf8"),
    );
  } catch {
    return false;
  }
}

/**
 * Inputs that decide a plain checkout's coordinates: the real root, a real owned `.git`
 * directory that Git accepts and that is not a linked-worktree directory, and the exact
 * repository configuration files, which may set `core.worktree` or `core.bare`. Any `GIT_*`
 * variable may redirect discovery, so its presence disables reuse. Null means the checkout is
 * not plain, so its coordinates are never reused.
 */
async function plainCheckoutInputs(root: string): Promise<string | null> {
  if (
    process.platform === "win32" ||
    Object.keys(process.env).some((name) => name.startsWith("GIT_"))
  )
    return null;
  const uid = process.getuid?.();
  const gitDirectory = resolve(root, ".git");
  try {
    const [rootInfo, gitInfo] = await Promise.all([
      lstat(root, { bigint: true }),
      lstat(gitDirectory, { bigint: true }),
    ]);
    if (
      !gitInfo.isDirectory() ||
      gitInfo.isSymbolicLink() ||
      Number(gitInfo.uid) !== uid ||
      Number(rootInfo.uid) !== uid ||
      (await configurationIdentity(resolve(gitDirectory, "commondir"))) !== "absent" ||
      !(await acceptedGitDirectory(gitDirectory))
    )
      return null;
    const configuration = await Promise.all(
      ["config", "config.worktree"].map((name) =>
        configurationIdentity(resolve(gitDirectory, name)),
      ),
    );
    if (configuration.includes(null)) return null;
    return JSON.stringify([await realpath(root), configuration]);
  } catch {
    return null;
  }
}

export async function gitCoordinates(root: string): Promise<GitCoordinates | null> {
  const inputs = await plainCheckoutInputs(root);
  const prior = remembered.get(root);
  if (inputs !== null && prior?.inputs === inputs) return { ...prior.coordinates };
  remembered.delete(root);
  const coordinates = await observeGit(root);
  if (
    inputs === null ||
    coordinates === null ||
    (await plainCheckoutInputs(root)) !== inputs ||
    (await realpath(coordinates.commonDirectory).catch(() => null)) !==
      resolve(await realpath(root), ".git")
  )
    return coordinates;
  if (remembered.size >= MAXIMUM_REMEMBERED_REPOSITORIES)
    remembered.delete(remembered.keys().next().value!);
  remembered.set(root, { coordinates: { ...coordinates }, inputs });
  return coordinates;
}
