import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import { readRepositoryHold } from "@lervo/repository-registry";

import {
  checkoutOnBaseBranch,
  gitVisiblePaths,
  repositoryCommittable,
} from "./checkout-base-branch.js";
import { knowledgeOutputCommitGrant } from "./convergence-owner-fence.js";
import { commitKnowledgeEffect, type KnowledgeEffectNotice } from "./knowledge-effect-commit.js";
import { knowledgeOutputCommitSafe } from "./knowledge-output-commit.js";
import { convergenceManagedKnowledgePath } from "./managed-knowledge-scope.js";

const execute = promisify(execFile);
const MAXIMUM_SNAPSHOT_BYTES = 256 * 1024 * 1024;

/** Why Lervo does not apply an effect it could otherwise apply, held as its own debt. */
export type KnowledgeEffectHold =
  | { reason: "owner_hold" }
  | { reason: "commit_unavailable"; detail: string }
  | { reason: "paths_uncommitted"; paths: string[] };

/** Paths whose bytes a person may edit: everything outside Lervo's own `.lervo` and outputs. */
export function knowledgeEffectUserPaths(paths: readonly string[]): string[] {
  return [
    ...new Set(
      paths.filter((path) => !path.startsWith(".lervo/") && !convergenceManagedKnowledgePath(path)),
    ),
  ].sort();
}

function statusPaths(output: string): string[] {
  const entries = output.split("\0");
  const paths: string[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (entry.length < 4) continue;
    paths.push(entry.slice(3));
    // A rename or copy names its source in the next entry.
    if (entry[0] === "R" || entry[0] === "C") index += 1;
  }
  return paths;
}

/**
 * ADR-0561 step two before an effect: it must land as its own commit, and no user path it touches
 * may hold uncommitted work. A commit adds whole files, and the undo restores the commit's parent,
 * so a dirty path would put the owner's unsaved edits into Lervo's commit and lose them on undo.
 * Returns why the effect is held, or null when it may apply. The owner's repository hold comes
 * first, so an upgrade or cycle already running when the owner holds the repository stops here.
 */
export async function knowledgeEffectPreflight(
  repositoryRoot: string,
  paths: readonly string[],
  /** ADR-0610: a generated-only effect in a directory with no commit to protect applies as is. */
  options: { generated?: boolean } = {},
): Promise<KnowledgeEffectHold | null> {
  if ((await readRepositoryHold(repositoryRoot)) !== null) return { reason: "owner_hold" };
  if (options.generated === true && !(await repositoryCommittable(repositoryRoot))) return null;
  // ADR-0610: Lervo's effect never lands in the owner's feature-branch or detached work.
  if (!(await checkoutOnBaseBranch(repositoryRoot)).onBase)
    return { reason: "commit_unavailable", detail: "not_on_base" };
  if (!(await knowledgeOutputCommitSafe(repositoryRoot)))
    return { reason: "commit_unavailable", detail: "git_unavailable_or_busy" };
  const grant = await knowledgeOutputCommitGrant(repositoryRoot);
  if (!grant.allowed) return { reason: "commit_unavailable", detail: grant.reason };
  const user = knowledgeEffectUserPaths(paths);
  if (user.length === 0) return null;
  const { stdout } = await execute(
    "git",
    [
      "-C",
      repositoryRoot,
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--",
      ...user,
    ],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  const dirty = [...new Set(statusPaths(stdout))].sort();
  return dirty.length === 0 ? null : { reason: "paths_uncommitted", paths: dirty.slice(0, 32) };
}

/** The exact bytes of each path before an effect, or null for a path that did not exist. */
async function snapshotPaths(
  repositoryRoot: string,
  paths: readonly string[],
): Promise<Map<string, Buffer | null>> {
  const snapshot = new Map<string, Buffer | null>();
  let total = 0;
  for (const path of new Set(paths)) {
    try {
      const bytes = await readFile(resolve(repositoryRoot, path));
      total += bytes.byteLength;
      if (total > MAXIMUM_SNAPSHOT_BYTES)
        throw new Error("The effect's paths exceed the bounded rollback snapshot.");
      snapshot.set(path, bytes);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      snapshot.set(path, null);
    }
  }
  return snapshot;
}

/** Puts every path back, then unstages what the failed commit had staged for them. */
async function restorePaths(
  repositoryRoot: string,
  snapshot: ReadonlyMap<string, Buffer | null>,
): Promise<void> {
  for (const [path, bytes] of snapshot) {
    const target = resolve(repositoryRoot, path);
    if (bytes === null) await rm(target, { force: true });
    else {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }
  }
  const reset = (paths: string[]) =>
    execute("git", ["-C", repositoryRoot, "reset", "-q", "--", ...paths]);
  await reset([...snapshot.keys()]).catch(async () => {
    // A path Git never knew can fail the batch; reset the rest one by one.
    for (const path of snapshot.keys()) await reset([path]).catch(() => undefined);
  });
}

/** The owner held the repository after the effect was planned; nothing was written. */
export class KnowledgeEffectOwnerHoldError extends Error {
  readonly code = "repository_owner_hold";
  constructor() {
    super("The owner holds this repository, so the effect was not applied.");
    this.name = "KnowledgeEffectOwnerHoldError";
  }
}

/** The effect applied but its commit did not land, so its bytes were put back. */
export class KnowledgeEffectUncommittedError extends Error {
  readonly code = "knowledge_effect_commit_failed";
  constructor(readonly reason: string) {
    super(
      `The effect could not be committed (${reason}), so its changed paths were restored and nothing stays applied.`,
    );
    this.name = "KnowledgeEffectUncommittedError";
  }
}

/** The commit an applied effect landed as, or `nothing_to_commit` when it left Git unchanged. */
export type CommittedKnowledgeEffect =
  | { status: "committed"; before: string; after: string }
  | { status: "not_committed"; reason: "nothing_to_commit" };

/**
 * ADR-0561: applies an effect and commits it as the undo point. When the commit does not land,
 * every changed path is restored to its bytes before the apply, so no applied effect is ever left
 * without its undo, and the error is thrown. An apply that throws part-way, such as on a lost
 * lease after its writes, restores the same way. An effect that changed nothing Git tracks needs
 * no undo commit and stays applied. The owner's hold is read again right before the first write.
 */
export async function applyCommittedKnowledgeEffect<T>(input: {
  repositoryRoot: string;
  paths: readonly string[];
  notice: KnowledgeEffectNotice;
  apply: () => Promise<T>;
  /** ADR-0610: a generated-only effect outside Git or before the first commit applies as is. */
  generated?: boolean;
}): Promise<{ receipt: T; commit: CommittedKnowledgeEffect }> {
  if ((await readRepositoryHold(input.repositoryRoot)) !== null)
    throw new KnowledgeEffectOwnerHoldError();
  if (input.generated === true && !(await repositoryCommittable(input.repositoryRoot)))
    return {
      receipt: await input.apply(),
      commit: { status: "not_committed", reason: "nothing_to_commit" },
    };
  // A generated effect's ignored paths, such as `.lervo/state` projections, leave nothing in Git,
  // so only the paths a commit carries are snapshotted, committed, and restored.
  const paths =
    input.generated === true
      ? await gitVisiblePaths(input.repositoryRoot, input.paths)
      : input.paths;
  // ADR-0610: off the base branch nothing is written, so there is nothing to restore either.
  if (!(await checkoutOnBaseBranch(input.repositoryRoot)).onBase)
    throw new KnowledgeEffectUncommittedError("not_on_base");
  const snapshot = await snapshotPaths(input.repositoryRoot, paths);
  let receipt: T;
  try {
    receipt = await input.apply();
  } catch (error) {
    await restorePaths(input.repositoryRoot, snapshot);
    throw error;
  }
  const commit =
    paths.length === 0
      ? ({ status: "not_committed", reason: "nothing_to_commit" } as const)
      : await commitKnowledgeEffect({
          repositoryRoot: input.repositoryRoot,
          paths,
          notice: input.notice,
        });
  if (commit.status === "committed" || commit.reason === "nothing_to_commit")
    return {
      receipt,
      commit:
        commit.status === "committed"
          ? commit
          : { status: "not_committed", reason: "nothing_to_commit" },
    };
  await restorePaths(input.repositoryRoot, snapshot);
  throw new KnowledgeEffectUncommittedError(commit.reason);
}
