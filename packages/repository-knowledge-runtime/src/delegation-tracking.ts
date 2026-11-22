import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { resolveProjectPaths } from "@lervo/project";

import { checkoutOnBaseBranch } from "./checkout-base-branch.js";
import { CONVERGENCE_HOST_TRAILER, knowledgeOutputCommitGrant } from "./convergence-owner-fence.js";
import { CONVERGENCE_DELEGATION_PATH } from "./delegation-contract.js";
import {
  KNOWLEDGE_OUTPUT_COMMIT_IDENTITY,
  knowledgeOutputCommitSafe,
} from "./knowledge-output-commit.js";

const execute = promisify(execFile);
const IGNORE_PATH = ".lervo/.gitignore";
/** The `.lervo/.gitignore` line, relative to `.lervo/`, that keeps the delegation host-local. */
const IGNORE_LINE = "knowledge/convergence-delegation.json";
export const DELEGATION_TRACKING_COMMIT_SUBJECT =
  "chore: keep the convergence delegation host-local";

function mirrorPath(root: string): string {
  return resolve(resolveProjectPaths(root).state, "knowledge", "convergence-delegation.json");
}

/** The untracking commit whose deletion this host already restored, so it restores once. */
function restoredMarkerPath(root: string): string {
  return resolve(resolveProjectPaths(root).state, "knowledge", "convergence-delegation.restored");
}

const mirrored = new Map<string, string>();

/**
 * ADR-0610: the last delegation this host read, kept under `.lervo/state`. Once the delegation is
 * untracked, pulling that commit makes Git delete the file in every other checkout; the loader
 * then restores this copy, so no host loses its delegation.
 */
export async function mirrorConvergenceDelegation(
  root: string,
  bytes: Uint8Array,
  contentHash: string,
): Promise<void> {
  const path = mirrorPath(root);
  if (mirrored.get(root) === contentHash && existsSync(path)) return;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, bytes, { mode: 0o600 });
  mirrored.set(root, contentHash);
}

/**
 * The mirrored delegation restored to its path, or null when there is none to restore. Only the
 * deletion that pulling the untracking commit caused is undone, and only once per commit: the
 * last commit touching the path must be that commit, and a later removal by the owner stands.
 */
export async function restoreMirroredConvergenceDelegation(
  root: string,
): Promise<Uint8Array | null> {
  if (!(await ignoresDelegation(root)) || (await trackedInHead(root))) return null;
  const last = await git(root, [
    "log",
    "-1",
    "--format=%H%x00%s",
    "--",
    CONVERGENCE_DELEGATION_PATH,
  ])
    .then((out) => out.trim().split("\0"))
    .catch(() => []);
  if (last.length !== 2 || last[1] !== DELEGATION_TRACKING_COMMIT_SUBJECT) return null;
  const marker = restoredMarkerPath(root);
  if ((await readFile(marker, "utf8").catch(() => "")).trim() === last[0]) return null;
  let bytes: Uint8Array;
  try {
    bytes = await readFile(mirrorPath(root));
  } catch {
    return null;
  }
  const target = resolve(root, CONVERGENCE_DELEGATION_PATH);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: "wx" }).catch(() => undefined);
  await writeFile(marker, `${last[0]}\n`, { mode: 0o600 });
  return bytes;
}

async function git(root: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  return (
    await execute("git", ["-C", root, ...args], {
      maxBuffer: 1024 * 1024,
      ...(env === undefined ? {} : { env: { ...process.env, ...env } }),
    })
  ).stdout;
}

async function trackedInHead(root: string): Promise<boolean> {
  return git(root, ["ls-tree", "--name-only", "HEAD", "--", CONVERGENCE_DELEGATION_PATH]).then(
    (out) => out.trim() === CONVERGENCE_DELEGATION_PATH,
    () => false,
  );
}

async function ignoreFile(root: string): Promise<string | null> {
  return readFile(resolve(root, IGNORE_PATH), "utf8").catch(() => null);
}

async function ignoresDelegation(root: string): Promise<boolean> {
  const text = await ignoreFile(root);
  return text !== null && text.split("\n").some((line) => line.trim() === IGNORE_LINE);
}

/**
 * ADR-0478 keeps the delegation untracked, but `lervo init` wrote the ignore line only for new
 * repositories, so older ones still track the file and every renewal left it uncommitted. On the
 * base branch the convergence owner adds the line and removes the file from the index in one
 * `Lervo Knowledge` commit, built in a private index so no other staged work is captured. The
 * file stays on disk. Returns `held` while that commit cannot be made here yet.
 */
export async function keepConvergenceDelegationHostLocal(
  root: string,
): Promise<"current" | "committed" | "held"> {
  const ignored = await ignoresDelegation(root);
  if (ignored && !(await trackedInHead(root))) return "current";
  if (
    !(await checkoutOnBaseBranch(root)).onBase ||
    !(await knowledgeOutputCommitSafe(root)) ||
    (await git(root, ["status", "--porcelain", "--", IGNORE_PATH]).catch(() => "?")).trim() !== ""
  )
    return "held";
  const grant = await knowledgeOutputCommitGrant(root);
  if (!grant.allowed) return "held";
  const before = (await git(root, ["rev-parse", "HEAD"])).trim();
  const previousIgnore = await ignoreFile(root);
  const nextIgnore = ignored
    ? previousIgnore!
    : `${previousIgnore === null || previousIgnore === "" || previousIgnore.endsWith("\n") ? (previousIgnore ?? "") : `${previousIgnore}\n`}${IGNORE_LINE}\n`;
  const scratch = await mkdtemp(join(tmpdir(), "lervo-delegation-index-"));
  const index = { GIT_INDEX_FILE: join(scratch, "index") };
  try {
    if (!ignored) await writeFile(resolve(root, IGNORE_PATH), nextIgnore);
    await git(root, ["read-tree", "HEAD"], index);
    await git(
      root,
      ["rm", "--cached", "--quiet", "--ignore-unmatch", "--", CONVERGENCE_DELEGATION_PATH],
      index,
    );
    // `-f`: a root `.gitignore` that ignores `.lervo/` must not block Lervo's own ignore file.
    await git(root, ["add", "-f", "--", IGNORE_PATH], index);
    const tree = (await git(root, ["write-tree"], index)).trim();
    const trailers = [
      "Lervo-Effect: knowledge_migration",
      ...(grant.hostHash === null ? [] : [`${CONVERGENCE_HOST_TRAILER}: ${grant.hostHash}`]),
    ].join("\n");
    const commit = (
      await git(
        root,
        [
          "commit-tree",
          tree,
          "-p",
          before,
          "-m",
          DELEGATION_TRACKING_COMMIT_SUBJECT,
          "-m",
          trailers,
        ],
        KNOWLEDGE_OUTPUT_COMMIT_IDENTITY,
      )
    ).trim();
    // The ref moves only from the HEAD this commit was built on, so a concurrent commit wins.
    await git(root, [
      "update-ref",
      "-m",
      DELEGATION_TRACKING_COMMIT_SUBJECT,
      "HEAD",
      commit,
      before,
    ]);
  } catch {
    if (!ignored)
      await (
        previousIgnore === null
          ? rm(resolve(root, IGNORE_PATH), { force: true })
          : writeFile(resolve(root, IGNORE_PATH), previousIgnore)
      ).catch(() => undefined);
    return "held";
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  // The real index follows the commit for these two paths only; the owner's other entries stay.
  await git(root, [
    "rm",
    "--cached",
    "--quiet",
    "--ignore-unmatch",
    "--",
    CONVERGENCE_DELEGATION_PATH,
  ]).catch(() => undefined);
  await git(root, ["add", "-f", "--", IGNORE_PATH]).catch(() => undefined);
  return "committed";
}
