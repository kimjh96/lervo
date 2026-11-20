import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertRepositoryReplicaSnapshot,
  calculateRepositoryReplicaSnapshotHash,
  type RepositoryReplicaSnapshot,
} from "@lervo/sync";

import type { RepositoryReplicaStage } from "./repository-replica-failure.js";
import { git, text } from "./repository-replica-git-command.js";

const CONVERGENCE_DELEGATION_PATH = ".lervo/knowledge/convergence-delegation.json";

/**
 * Host-local paths whose worktree bytes never enter a replica snapshot and survive replica
 * cleanup. They are excluded explicitly because `HEAD` or the worktree may predate the matching
 * ignore rule. Git rejects exclusion pathspecs under an ignored directory, so capture restores
 * their `HEAD` entries after staging instead.
 *
 * ADR-0478: the convergence delegation is host-local only while `HEAD` does not track it. A
 * tracked delegation is shared repository content that only the convergence owner writes, so its
 * worktree bytes replicate and the peer receives the owner's exact renewal.
 */
export const HOST_LOCAL_REPLICA_PATHS = [
  CONVERGENCE_DELEGATION_PATH,
  ".lervo/state",
  ".lervo/data",
  ".lervo/run",
] as const;

async function hostLocalPathspecs(repositoryRoot: string): Promise<string[]> {
  const tracked = text(
    await git(repositoryRoot, [
      "ls-tree",
      "--name-only",
      "HEAD",
      "--",
      CONVERGENCE_DELEGATION_PATH,
    ]),
  );
  return HOST_LOCAL_REPLICA_PATHS.filter(
    (path) => path !== CONVERGENCE_DELEGATION_PATH || tracked !== CONVERGENCE_DELEGATION_PATH,
  ).map((path) => `:(top,literal)${path}`);
}
export const EXPORT_REF = "refs/lervo/replica/export";
export const INCOMING_REF = "refs/lervo/replica/incoming";
export const FIXED_GIT_ENVIRONMENT = {
  GIT_AUTHOR_NAME: "Lervo Repository Replica",
  GIT_AUTHOR_EMAIL: "repository-replica@lervo.local",
  GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
  GIT_COMMITTER_NAME: "Lervo Repository Replica",
  GIT_COMMITTER_EMAIL: "repository-replica@lervo.local",
  GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
};

type RepositoryReplicaGitErrorCode =
  | "repository_replica_snapshot_failed"
  | "repository_replica_bundle_failed"
  | "repository_replica_conflict"
  | "repository_replica_apply_failed"
  | "repository_replica_merge_failed";

const GIT_ERROR_STAGES: Record<RepositoryReplicaGitErrorCode, RepositoryReplicaStage> = {
  repository_replica_snapshot_failed: "snapshot",
  repository_replica_bundle_failed: "bundle",
  repository_replica_conflict: "verify",
  repository_replica_apply_failed: "apply",
  repository_replica_merge_failed: "merge",
};

export class RepositoryReplicaGitError extends Error {
  readonly stage: RepositoryReplicaStage;

  constructor(
    readonly code: RepositoryReplicaGitErrorCode,
    message: string,
    options?: ErrorOptions & { stage?: RepositoryReplicaStage },
  ) {
    super(message, options);
    this.name = "RepositoryReplicaGitError";
    this.stage = options?.stage ?? GIT_ERROR_STAGES[code];
  }
}

function snapshotSource(snapshot: RepositoryReplicaSnapshot): string {
  return `${JSON.stringify(snapshot)}\n`;
}

export async function createExportCommit(
  repositoryRoot: string,
  snapshot: RepositoryReplicaSnapshot,
): Promise<void> {
  const environment = FIXED_GIT_ENVIRONMENT;
  const indexCommit = text(
    await git(repositoryRoot, ["commit-tree", snapshot.indexTree, "-p", snapshot.head], {
      input: `lervo-repository-replica-index-v1\n${snapshotSource(snapshot)}`,
      environment,
    }),
  );
  const worktreeCommit = text(
    await git(
      repositoryRoot,
      ["commit-tree", snapshot.worktreeTree, "-p", snapshot.head, "-p", indexCommit],
      {
        input: `lervo-repository-replica-worktree-v1\n${snapshotSource(snapshot)}`,
        environment,
      },
    ),
  );
  await git(repositoryRoot, ["update-ref", EXPORT_REF, worktreeCommit]);
}

export async function captureRepositoryReplicaSnapshot(
  repositoryRoot: string,
): Promise<RepositoryReplicaSnapshot> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "lervo-repository-replica-"));
  const temporaryIndex = join(temporaryDirectory, "index");
  try {
    const head = text(await git(repositoryRoot, ["rev-parse", "HEAD"]));
    const branchResult = await git(repositoryRoot, ["symbolic-ref", "--short", "HEAD"], {
      allowedExitCodes: [0, 1],
    });
    const branch = branchResult.exitCode === 0 ? text(branchResult) : null;
    const environment = { GIT_INDEX_FILE: temporaryIndex };
    const indexPath = text(
      await git(repositoryRoot, ["rev-parse", "--path-format=absolute", "--git-path", "index"]),
    );
    try {
      await copyFile(indexPath, temporaryIndex);
      // Git re-hashes entries modified at or after the index timestamp (racy entries). The copy
      // must never look newer than the original, or a same-size edit made in the timestamp tick
      // of the last index write would be trusted by stale stat data. Earlier is always safe.
      const racyBefore = Math.floor((await stat(indexPath)).mtimeMs / 1_000) - 1;
      await utimes(temporaryIndex, racyBefore, racyBefore);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await git(repositoryRoot, ["read-tree", "--empty"], { environment });
    }
    const indexTree = text(await git(repositoryRoot, ["write-tree"], { environment }));
    // A reset keeps the copied index's stat data for entries that already match HEAD, so staging
    // re-hashes only files whose metadata changed instead of the whole worktree. Plain
    // `read-tree HEAD` produces the same entries but discards every stat entry.
    await git(repositoryRoot, ["read-tree", "--reset", "HEAD"], { environment });
    await git(repositoryRoot, ["add", "-A", "--", "."], { environment });
    // Host-local paths keep exactly their HEAD entries, whatever the ignore rules say.
    const hostLocal = await hostLocalPathspecs(repositoryRoot);
    await git(repositoryRoot, ["reset", "-q", "HEAD", "--", ...hostLocal], { environment });
    const worktreeTree = text(await git(repositoryRoot, ["write-tree"], { environment }));
    const source = { schemaVersion: 1 as const, head, branch, indexTree, worktreeTree };
    const snapshot: RepositoryReplicaSnapshot = {
      ...source,
      snapshotHash: calculateRepositoryReplicaSnapshotHash(source),
    };
    assertRepositoryReplicaSnapshot(snapshot);
    return snapshot;
  } catch (error) {
    if (error instanceof RepositoryReplicaGitError) throw error;
    throw new RepositoryReplicaGitError(
      "repository_replica_snapshot_failed",
      "The exact repository replica snapshot could not be captured.",
      { cause: error },
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function createRepositoryReplicaBundle(
  repositoryRoot: string,
  expectedSnapshotHash?: string,
): Promise<Uint8Array> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "lervo-repository-bundle-"));
  const bundlePath = join(temporaryDirectory, "replica.bundle");
  try {
    const snapshot = await captureRepositoryReplicaSnapshot(repositoryRoot);
    if (expectedSnapshotHash !== undefined && snapshot.snapshotHash !== expectedSnapshotHash) {
      throw new RepositoryReplicaGitError(
        "repository_replica_conflict",
        `The repository changed before its replica bundle was created (${snapshot.snapshotHash} != ${expectedSnapshotHash}).`,
      );
    }
    await createExportCommit(repositoryRoot, snapshot);
    await git(repositoryRoot, ["bundle", "create", bundlePath, EXPORT_REF]);
    return new Uint8Array(await readFile(bundlePath));
  } catch (error) {
    if (error instanceof RepositoryReplicaGitError) throw error;
    throw new RepositoryReplicaGitError(
      "repository_replica_bundle_failed",
      "The repository replica bundle could not be created.",
      { cause: error },
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function isAncestor(repositoryRoot: string, ancestor: string, descendant: string) {
  return (
    (
      await git(repositoryRoot, ["merge-base", "--is-ancestor", ancestor, descendant], {
        allowedExitCodes: [0, 1],
      })
    ).exitCode === 0
  );
}

export async function applyTrees(
  repositoryRoot: string,
  current: RepositoryReplicaSnapshot,
  desired: RepositoryReplicaSnapshot,
  allowHistoryReplacement = false,
): Promise<void> {
  const historyChanged = current.head !== desired.head;
  const branchChanged = current.branch !== desired.branch;
  if (historyChanged || branchChanged) {
    const fastForward =
      historyChanged &&
      current.branch !== null &&
      desired.branch === current.branch &&
      (await isAncestor(repositoryRoot, current.head, desired.head));
    if (!allowHistoryReplacement && !fastForward) {
      throw new RepositoryReplicaGitError(
        "repository_replica_conflict",
        "Repository replica history is detached, rewound, or divergent.",
      );
    }
    if (allowHistoryReplacement) {
      await createExportCommit(repositoryRoot, current);
      await git(repositoryRoot, [
        "update-ref",
        `refs/lervo/replica/recovery/${current.snapshotHash.slice("sha256:".length)}`,
        EXPORT_REF,
      ]);
      if (desired.branch === null) {
        await git(repositoryRoot, ["symbolic-ref", "--delete", "HEAD"], {
          allowedExitCodes: [0, 1],
        });
        await git(repositoryRoot, ["update-ref", "HEAD", desired.head]);
      } else {
        await git(repositoryRoot, ["update-ref", `refs/heads/${desired.branch}`, desired.head]);
        await git(repositoryRoot, ["symbolic-ref", "HEAD", `refs/heads/${desired.branch}`]);
      }
    } else {
      await git(repositoryRoot, [
        "update-ref",
        `refs/heads/${current.branch}`,
        desired.head,
        current.head,
      ]);
    }
  }
  await git(repositoryRoot, ["reset", "--hard", desired.head]);
  // HEAD may precede the worktree's ignore rule. Keep host-local grants and state even while
  // the reset temporarily restores an older .lervo/.gitignore.
  await git(repositoryRoot, [
    "clean",
    "-fd",
    ...HOST_LOCAL_REPLICA_PATHS.flatMap((path) => ["-e", `/${path}`]),
  ]);
  await git(repositoryRoot, ["read-tree", desired.indexTree]);
  await git(repositoryRoot, ["checkout-index", "--all", "--force"]);
  const patch = (
    await git(repositoryRoot, [
      "diff",
      "--binary",
      "--full-index",
      "--no-ext-diff",
      desired.indexTree,
      desired.worktreeTree,
    ])
  ).stdout;
  if (patch.byteLength > 0) {
    await git(repositoryRoot, ["apply", "--binary", "--whitespace=nowarn"], { input: patch });
  }
}

export function parseIncomingSnapshot(message: string): RepositoryReplicaSnapshot {
  const lines = message.trim().split("\n");
  if (lines[0] !== "lervo-repository-replica-worktree-v1" || lines[1] === undefined) {
    throw new Error("The incoming repository replica commit has no supported envelope.");
  }
  const snapshot = JSON.parse(lines[1]) as RepositoryReplicaSnapshot;
  assertRepositoryReplicaSnapshot(snapshot);
  return snapshot;
}

export async function verifyIncomingCommit(
  repositoryRoot: string,
  snapshot: RepositoryReplicaSnapshot,
): Promise<void> {
  const commit = text(await git(repositoryRoot, ["rev-parse", `${INCOMING_REF}^{commit}`]));
  const [worktreeTree, parents, message] = await Promise.all([
    git(repositoryRoot, ["show", "-s", "--format=%T", commit]).then(text),
    git(repositoryRoot, ["show", "-s", "--format=%P", commit]).then(text),
    git(repositoryRoot, ["show", "-s", "--format=%B", commit]).then((value) =>
      value.stdout.toString("utf8"),
    ),
  ]);
  const [head, indexCommit, ...additionalParents] = parents.split(" ");
  if (
    worktreeTree !== snapshot.worktreeTree ||
    head !== snapshot.head ||
    indexCommit === undefined ||
    additionalParents.length > 0 ||
    parseIncomingSnapshot(message).snapshotHash !== snapshot.snapshotHash ||
    text(await git(repositoryRoot, ["show", "-s", "--format=%T", indexCommit])) !==
      snapshot.indexTree
  ) {
    throw new Error("The incoming repository replica Git objects differ from their envelope.");
  }
}

export async function applyRepositoryReplicaBundle(input: {
  repositoryRoot: string;
  bundle: Uint8Array;
  expectedCurrentSnapshotHash: string;
  allowHistoryReplacement?: boolean;
}): Promise<RepositoryReplicaSnapshot> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "lervo-repository-import-"));
  const bundlePath = join(temporaryDirectory, "replica.bundle");
  let current: RepositoryReplicaSnapshot | null = null;
  try {
    current = await captureRepositoryReplicaSnapshot(input.repositoryRoot);
    if (current.snapshotHash !== input.expectedCurrentSnapshotHash) {
      throw new RepositoryReplicaGitError(
        "repository_replica_conflict",
        `The repository changed after replica reconciliation (${current.snapshotHash} != ${input.expectedCurrentSnapshotHash}).`,
      );
    }
    await writeFile(bundlePath, input.bundle, { mode: 0o600 });
    await git(input.repositoryRoot, ["bundle", "verify", bundlePath]);
    await git(input.repositoryRoot, [
      "fetch",
      "--no-tags",
      bundlePath,
      `+${EXPORT_REF}:${INCOMING_REF}`,
    ]);
    const message = (
      await git(input.repositoryRoot, ["show", "-s", "--format=%B", INCOMING_REF])
    ).stdout.toString("utf8");
    const desired = parseIncomingSnapshot(message);
    await verifyIncomingCommit(input.repositoryRoot, desired);
    await applyTrees(
      input.repositoryRoot,
      current,
      desired,
      input.allowHistoryReplacement === true,
    );
    const applied = await captureRepositoryReplicaSnapshot(input.repositoryRoot);
    if (applied.snapshotHash !== desired.snapshotHash) {
      throw new Error("The applied repository replica differs from the source snapshot.");
    }
    return applied;
  } catch (error) {
    if (
      current !== null &&
      !(error instanceof RepositoryReplicaGitError && error.code === "repository_replica_conflict")
    ) {
      try {
        const observed = await captureRepositoryReplicaSnapshot(input.repositoryRoot);
        if (
          observed.head !== current.head &&
          observed.branch === current.branch &&
          current.branch !== null
        ) {
          await git(input.repositoryRoot, [
            "update-ref",
            `refs/heads/${current.branch}`,
            current.head,
            observed.head,
          ]);
        }
        await applyTrees(input.repositoryRoot, { ...observed, head: current.head }, current);
      } catch {
        // The apply failure stays the cause; the stage records that rollback was not proven.
        throw new RepositoryReplicaGitError(
          "repository_replica_apply_failed",
          "Repository replica apply failed and automatic rollback could not be proven.",
          { cause: error, stage: "rollback" },
        );
      }
    }
    if (error instanceof RepositoryReplicaGitError) throw error;
    throw new RepositoryReplicaGitError(
      "repository_replica_apply_failed",
      "The repository replica bundle could not be applied.",
      { cause: error },
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export function repositoryReplicaBundleDigest(bundle: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bundle).digest("hex")}`;
}
