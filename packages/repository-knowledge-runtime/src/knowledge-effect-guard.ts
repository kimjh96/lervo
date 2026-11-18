import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import { knowledgeOutputCommitGrant } from "./convergence-owner-fence.js";
import { commitKnowledgeEffect, type KnowledgeEffectNotice } from "./knowledge-effect-commit.js";
import { knowledgeOutputCommitSafe } from "./knowledge-output-commit.js";
import { convergenceManagedKnowledgePath } from "./managed-knowledge-scope.js";

const execute = promisify(execFile);
const MAXIMUM_SNAPSHOT_BYTES = 256 * 1024 * 1024;

/** Why Lervo does not apply an effect it could otherwise apply, held as its own debt. */
export type KnowledgeEffectHold =
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
 * Returns why the effect is held, or null when it may apply.
 */
export async function knowledgeEffectPreflight(
  repositoryRoot: string,
  paths: readonly string[],
): Promise<KnowledgeEffectHold | null> {
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
 * without its undo, and the error is thrown. An effect that changed nothing Git tracks needs no
 * undo commit and stays applied.
 */
export async function applyCommittedKnowledgeEffect<T>(input: {
  repositoryRoot: string;
  paths: readonly string[];
  notice: KnowledgeEffectNotice;
  apply: () => Promise<T>;
}): Promise<{ receipt: T; commit: CommittedKnowledgeEffect }> {
  const snapshot = await snapshotPaths(input.repositoryRoot, input.paths);
  const receipt = await input.apply();
  const commit = await commitKnowledgeEffect({
    repositoryRoot: input.repositoryRoot,
    paths: input.paths,
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
