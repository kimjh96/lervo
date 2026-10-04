import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertRepositoryReplicaSnapshot,
  calculateRepositoryReplicaSnapshotHash,
  type RepositoryReplicaSnapshot,
} from "@lervo/sync";

import {
  EXPORT_REF,
  FIXED_GIT_ENVIRONMENT,
  INCOMING_REF,
  RepositoryReplicaGitError,
  applyTrees,
  captureRepositoryReplicaSnapshot,
  createExportCommit,
  isAncestor,
  parseIncomingSnapshot,
  verifyIncomingCommit,
} from "./repository-replica-git.js";
import { git, text } from "./repository-replica-git-command.js";

const MERGE_AUTHOR_ENVIRONMENT = {
  GIT_AUTHOR_NAME: FIXED_GIT_ENVIRONMENT.GIT_AUTHOR_NAME,
  GIT_AUTHOR_EMAIL: FIXED_GIT_ENVIRONMENT.GIT_AUTHOR_EMAIL,
  GIT_COMMITTER_NAME: FIXED_GIT_ENVIRONMENT.GIT_COMMITTER_NAME,
  GIT_COMMITTER_EMAIL: FIXED_GIT_ENVIRONMENT.GIT_COMMITTER_EMAIL,
};
const MAXIMUM_REPORTED_CONFLICT_PATHS = 16;

/** How textual conflicts outside generated knowledge are resolved; `hold` writes nothing. */
export type RepositoryReplicaConflictPolicy = "hold" | "prefer_local" | "prefer_peer";

/**
 * Rebuildable Lervo knowledge projections; a conflict confined to them resolves to the local side
 * and the merge reports how many paths it resolved that way.
 */
const GENERATED_PATH_PREFIXES = [".lervo/knowledge/", ".lervo/generated/"];

function generatedOnly(paths: readonly string[]): boolean {
  return paths.every((path) => GENERATED_PATH_PREFIXES.some((prefix) => path.startsWith(prefix)));
}

export type RepositoryReplicaMergeResult =
  | {
      status: "merged";
      snapshot: RepositoryReplicaSnapshot;
      mergeCommit: string | null;
      /** Conflicting generated paths resolved to the local side; reported, never silent. */
      generatedResolutionCount: number;
    }
  | {
      status: "conflict";
      reason: "no_common_history" | "conflicting_paths";
      paths: string[];
      pathCount: number;
    };

/** Three-way tree merge through `git merge-tree`; a conflict reports bounded paths and writes nothing. */
async function mergeTrees(
  repositoryRoot: string,
  ours: string,
  theirs: string,
  strategy?: "ours" | "theirs",
): Promise<{ tree: string } | { paths: string[]; pathCount: number }> {
  const result = await git(
    repositoryRoot,
    [
      "merge-tree",
      "--write-tree",
      "--name-only",
      "--no-messages",
      ...(strategy === undefined ? [] : [`-X${strategy}`]),
      ours,
      theirs,
    ],
    { allowedExitCodes: [0, 1] },
  );
  const lines = result.stdout
    .toString("utf8")
    .split("\n")
    .filter((line) => line.length > 0);
  const tree = lines[0];
  if (tree === undefined || !/^[a-f0-9]{40,64}$/u.test(tree))
    throw new Error("Git merge-tree returned no merged tree.");
  if (result.exitCode === 0) return { tree };
  const paths = lines.slice(1);
  return { paths: paths.slice(0, MAXIMUM_REPORTED_CONFLICT_PATHS), pathCount: paths.length };
}

/** Retries a conflicting merge with the side the policy allows; generated-only conflicts always resolve locally. */
async function mergeTreesWithPolicy(
  repositoryRoot: string,
  ours: string,
  theirs: string,
  policy: RepositoryReplicaConflictPolicy,
): Promise<
  { tree: string; generatedResolutionCount: number } | { paths: string[]; pathCount: number }
> {
  const first = await mergeTrees(repositoryRoot, ours, theirs);
  if ("tree" in first) return { ...first, generatedResolutionCount: 0 };
  const allPaths =
    first.pathCount === first.paths.length
      ? first.paths
      : (
          await git(
            repositoryRoot,
            ["merge-tree", "--write-tree", "--name-only", "--no-messages", ours, theirs],
            { allowedExitCodes: [0, 1] },
          )
        ).stdout
          .toString("utf8")
          .split("\n")
          .filter((line) => line.length > 0)
          .slice(1);
  const generated = generatedOnly(allPaths);
  const strategy =
    generated || policy === "prefer_local"
      ? "ours"
      : policy === "prefer_peer"
        ? "theirs"
        : undefined;
  if (strategy === undefined) return first;
  const resolved = await mergeTrees(repositoryRoot, ours, theirs, strategy);
  return "tree" in resolved
    ? { ...resolved, generatedResolutionCount: generated ? allPaths.length : 0 }
    : resolved;
}

/**
 * Merges the peer's exact replica into this repository when both sides changed. Committed history
 * gains one merge commit on the current branch (or fast-forwards); uncommitted work from both sides
 * stays uncommitted in the merged worktree; the index is reset to the merged commit. Any textual
 * conflict leaves the repository untouched and names the conflicting paths.
 */
export async function mergeRepositoryReplicaBundle(input: {
  repositoryRoot: string;
  bundle: Uint8Array;
  expectedCurrentSnapshotHash: string;
  conflictPolicy?: RepositoryReplicaConflictPolicy;
}): Promise<RepositoryReplicaMergeResult> {
  const policy = input.conflictPolicy ?? "hold";
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "lervo-repository-merge-"));
  const bundlePath = join(temporaryDirectory, "replica.bundle");
  const root = input.repositoryRoot;
  try {
    const current = await captureRepositoryReplicaSnapshot(root);
    if (current.snapshotHash !== input.expectedCurrentSnapshotHash) {
      throw new RepositoryReplicaGitError(
        "repository_replica_conflict",
        `The repository changed before replica merge (${current.snapshotHash} != ${input.expectedCurrentSnapshotHash}).`,
      );
    }
    await writeFile(bundlePath, input.bundle, { mode: 0o600 });
    await git(root, ["bundle", "verify", bundlePath]);
    await git(root, ["fetch", "--no-tags", bundlePath, `+${EXPORT_REF}:${INCOMING_REF}`]);
    const theirs = parseIncomingSnapshot(
      (await git(root, ["show", "-s", "--format=%B", INCOMING_REF])).stdout.toString("utf8"),
    );
    await verifyIncomingCommit(root, theirs);
    const base = await git(root, ["merge-base", current.head, theirs.head], {
      allowedExitCodes: [0, 1],
    });
    if (base.exitCode !== 0)
      return { status: "conflict", reason: "no_common_history", paths: [], pathCount: 0 };
    let mergeCommit: string | null = null;
    let head = current.head;
    let committedTree: string;
    let generatedResolutionCount = 0;
    if (await isAncestor(root, theirs.head, current.head)) {
      committedTree = text(await git(root, ["rev-parse", `${current.head}^{tree}`]));
    } else if (await isAncestor(root, current.head, theirs.head)) {
      head = theirs.head;
      committedTree = text(await git(root, ["rev-parse", `${theirs.head}^{tree}`]));
    } else {
      const committed = await mergeTreesWithPolicy(root, current.head, theirs.head, policy);
      if ("paths" in committed)
        return { status: "conflict", reason: "conflicting_paths", ...committed };
      committedTree = committed.tree;
      generatedResolutionCount = committed.generatedResolutionCount;
      mergeCommit = text(
        await git(root, ["commit-tree", committedTree, "-p", current.head, "-p", theirs.head], {
          input: "Merge repository replica peer history\n",
          environment: MERGE_AUTHOR_ENVIRONMENT,
        }),
      );
      head = mergeCommit;
    }
    await createExportCommit(root, current);
    const worktree = await mergeTreesWithPolicy(root, EXPORT_REF, INCOMING_REF, policy);
    if ("paths" in worktree)
      return { status: "conflict", reason: "conflicting_paths", ...worktree };
    const source = {
      schemaVersion: 1 as const,
      head,
      branch: current.branch,
      indexTree: committedTree,
      worktreeTree: worktree.tree,
    };
    const desired: RepositoryReplicaSnapshot = {
      ...source,
      snapshotHash: calculateRepositoryReplicaSnapshotHash(source),
    };
    assertRepositoryReplicaSnapshot(desired);
    await applyTrees(root, current, desired, true);
    const applied = await captureRepositoryReplicaSnapshot(root);
    if (applied.snapshotHash !== desired.snapshotHash)
      throw new Error("The merged repository replica differs from the computed merge.");
    return {
      status: "merged",
      snapshot: applied,
      mergeCommit,
      generatedResolutionCount: Math.max(
        generatedResolutionCount,
        worktree.generatedResolutionCount,
      ),
    };
  } catch (error) {
    if (error instanceof RepositoryReplicaGitError) throw error;
    throw new RepositoryReplicaGitError(
      "repository_replica_merge_failed",
      "The repository replica merge could not be applied.",
      { cause: error },
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
