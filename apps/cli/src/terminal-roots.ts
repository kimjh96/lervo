// Where a terminal session runs and where its evidence belongs. A linked git worktree of a
// registered repository, such as an ADE workspace or a developer's extra checkout, runs in its own
// files but records into the registered repository, as managed runs already do: the worktree's
// own store has no writer contract, no resident, and is deleted with the worktree.
import { execFile } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { isConversationWorkspace, readNewestCheckoutWorkspace } from "@lervo/agent-workforce";
import {
  defaultRepositoryRegistryPath,
  listRegisteredRepositories,
} from "@lervo/repository-registry";

import { checkoutPathDigests } from "./checkout-path-digests.js";
import { resolveTerminalRepositoryRoot } from "./terminal-repository-root.js";

const run = promisify(execFile);
const GIT_TIMEOUT_MS = 2_000;

/**
 * Why the evidence root is what it is:
 * - `checkout`: a main checkout, which keeps its own evidence;
 * - `linked_worktree`: a linked worktree of a registered repository, which records there;
 * - `worker_workspace`: a live worker workspace, whose attachment keeps its evidence local; a
 *   conversation's workspace generation is a `linked_worktree`;
 * - `linked_worktree_unregistered`: no registered repository owns the main checkout;
 * - `linked_worktree_unresolved`: Git could not name the main checkout, such as a bare
 *   repository's worktree or a Git failure.
 */
export type TerminalRootsReason =
  | "checkout"
  | "linked_worktree"
  | "worker_workspace"
  | "linked_worktree_unregistered"
  | "linked_worktree_unresolved";

export interface TerminalRoots {
  /** The checkout the session runs in: its files, snapshot, and Git state. */
  readonly executionRoot: string;
  /** The repository its events, queues, and shared state belong to. */
  readonly evidenceRoot: string;
  readonly reason: TerminalRootsReason;
}

/** Git's view of a checkout, every path absolute and real. */
export interface TerminalGitCoordinates {
  readonly topLevel: string;
  readonly gitDirectory: string;
  readonly commonDirectory: string;
}

export interface TerminalRootsPorts {
  gitCoordinates(root: string): Promise<TerminalGitCoordinates | null>;
  /** The real paths of the host's registered repositories. */
  registeredRoots(): Promise<readonly string[]>;
  /**
   * Whether a live worker workspace claims the checkout at `root`: the checkout's newest record
   * that is not removed. A conversation's generation keeps ADR-0633's two roots, since its
   * session records into the registered repository like any linked worktree's.
   */
  workerCheckout(root: string): Promise<boolean>;
}

async function isDirectory(path: string): Promise<boolean> {
  return lstat(path).then(
    (found) => found.isDirectory(),
    () => false,
  );
}

async function realOrNull(path: string): Promise<string | null> {
  return realpath(path).catch(() => null);
}

/** The process environment without variables that would point Git at another repository. */
function gitEnvironment(): NodeJS.ProcessEnv {
  const { GIT_DIR: _dir, GIT_WORK_TREE: _tree, GIT_COMMON_DIR: _common, ...rest } = process.env;
  return rest;
}

export const defaultTerminalRootsPorts: TerminalRootsPorts = {
  async gitCoordinates(root) {
    try {
      const { stdout } = await run(
        "git",
        [
          "-C",
          root,
          "rev-parse",
          "--path-format=absolute",
          "--show-toplevel",
          "--git-dir",
          "--git-common-dir",
        ],
        { timeout: GIT_TIMEOUT_MS, env: gitEnvironment() },
      );
      const [topLevel, gitDirectory, commonDirectory] = stdout.trimEnd().split("\n");
      if (topLevel === undefined || gitDirectory === undefined || commonDirectory === undefined)
        return null;
      const real = await Promise.all([topLevel, gitDirectory, commonDirectory].map(realOrNull));
      if (real.some((path) => path === null)) return null;
      return { topLevel: real[0]!, gitDirectory: real[1]!, commonDirectory: real[2]! };
    } catch {
      return null;
    }
  },
  async registeredRoots() {
    const registrations = await listRegisteredRepositories(defaultRepositoryRegistryPath()).catch(
      () => [],
    );
    const roots = await Promise.all(
      registrations.map((registration) => realOrNull(registration.repositoryRoot)),
    );
    return roots.filter((root): root is string => root !== null);
  },
  async workerCheckout(root) {
    const newest = await readNewestCheckoutWorkspace(root, await checkoutPathDigests(root)).catch(
      () => null,
    );
    return newest !== null && !isConversationWorkspace(newest);
  },
};

/** The roots of a terminal session whose working directory is `cwd`. */
export async function resolveTerminalRoots(
  cwd: string,
  ports: TerminalRootsPorts = defaultTerminalRootsPorts,
): Promise<TerminalRoots> {
  const executionRoot = await resolveTerminalRepositoryRoot(cwd);
  const local = (reason: TerminalRootsReason): TerminalRoots => ({
    executionRoot,
    evidenceRoot: executionRoot,
    reason,
  });
  // A main checkout keeps `.git` as a directory, so the common case spawns no Git.
  if (await isDirectory(resolve(executionRoot, ".git"))) return local("checkout");
  const git = await ports.gitCoordinates(executionRoot);
  if (git === null) return local("checkout");
  if (git.gitDirectory === git.commonDirectory) return local("checkout");
  // A non-bare repository keeps its shared directory at `<main checkout>/.git`.
  if (basename(git.commonDirectory) !== ".git") return local("linked_worktree_unresolved");
  const realExecution = await realOrNull(executionRoot);
  if (realExecution === null) return local("linked_worktree_unresolved");
  const inside = relative(git.topLevel, realExecution);
  if (inside.startsWith(`..${sep}`) || inside === "..") return local("linked_worktree_unresolved");
  // The Lervo project may sit below the Git top level; the same place in the main checkout.
  const candidate = resolve(dirname(git.commonDirectory), inside);
  if (!(await ports.registeredRoots()).includes(candidate))
    return local("linked_worktree_unregistered");
  if (await ports.workerCheckout(executionRoot)) return local("worker_workspace");
  return { executionRoot, evidenceRoot: candidate, reason: "linked_worktree" };
}

/**
 * The roots of a CLI command aimed at `root`, its `--root` or working directory. A command run
 * in a linked worktree records into the registered repository like the worktree's hooks do. A
 * path in no initialized project keeps the single root the command always had.
 */
export async function resolveCommandRoots(
  root: string,
  ports: TerminalRootsPorts = defaultTerminalRootsPorts,
): Promise<TerminalRoots> {
  try {
    return await resolveTerminalRoots(root, ports);
  } catch {
    return { executionRoot: root, evidenceRoot: root, reason: "checkout" };
  }
}
