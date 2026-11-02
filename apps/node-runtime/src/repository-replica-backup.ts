import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  captureRepositoryReplicaSnapshot,
  createExportCommit,
  EXPORT_REF,
  parseIncomingSnapshot,
} from "./repository-replica-git.js";
import { git, text } from "./repository-replica-git-command.js";

const BACKUP_BRANCH_PREFIX = "lervo/replica-backup";

/** The backup branch for one divergence; the same divergence always names the same branch. */
export function repositoryReplicaBackupBranch(replicaId: string, divergenceId: string): string {
  return `${BACKUP_BRANCH_PREFIX}/${replicaId}/${divergenceId.slice("sha256:".length, "sha256:".length + 12)}`;
}

/** Reads the snapshot hash a backup branch holds, or null when the branch does not exist. */
async function backedUpSnapshotHash(repositoryRoot: string, ref: string): Promise<string | null> {
  const resolved = await git(
    repositoryRoot,
    ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
    {
      allowedExitCodes: [0, 1],
    },
  );
  if (resolved.exitCode !== 0) return null;
  const commit = text(resolved);
  const [tree, message] = await Promise.all([
    git(repositoryRoot, ["show", "-s", "--format=%T", commit]).then(text),
    git(repositoryRoot, ["show", "-s", "--format=%B", commit]).then((value) =>
      value.stdout.toString("utf8"),
    ),
  ]);
  const snapshot = parseIncomingSnapshot(message);
  if (snapshot.worktreeTree !== tree)
    throw new Error("The replica backup branch differs from its recorded snapshot.");
  return snapshot.snapshotHash;
}

/**
 * ADR-0561: saves the losing side of a replica conflict to a branch in this repository before
 * either side changes. The branch holds the exact snapshot, uncommitted work included, as the
 * replica export commit. `bundle` carries the peer's side; null saves this repository's own side.
 * Returns the snapshot hash the branch verifiably holds, which the caller compares with the
 * losing side it decided on. An existing branch for the same divergence is reused, never moved.
 */
export async function saveRepositoryReplicaBackup(input: {
  repositoryRoot: string;
  branch: string;
  bundle: Uint8Array | null;
  expectedSnapshotHash: string;
}): Promise<{ branch: string; snapshotHash: string }> {
  const ref = `refs/heads/${input.branch}`;
  const existing = await backedUpSnapshotHash(input.repositoryRoot, ref);
  if (existing !== null) return { branch: input.branch, snapshotHash: existing };
  if (input.bundle === null) {
    const current = await captureRepositoryReplicaSnapshot(input.repositoryRoot);
    if (current.snapshotHash !== input.expectedSnapshotHash)
      throw new Error("The repository changed before its replica backup was saved.");
    await createExportCommit(input.repositoryRoot, current);
    await git(input.repositoryRoot, ["update-ref", ref, EXPORT_REF, ""]);
  } else {
    const directory = await mkdtemp(join(tmpdir(), "lervo-repository-backup-"));
    try {
      const bundlePath = join(directory, "replica.bundle");
      await writeFile(bundlePath, input.bundle, { mode: 0o600 });
      await git(input.repositoryRoot, ["bundle", "verify", bundlePath]);
      await git(input.repositoryRoot, ["fetch", "--no-tags", bundlePath, `${EXPORT_REF}:${ref}`]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  const saved = await backedUpSnapshotHash(input.repositoryRoot, ref);
  if (saved === null) throw new Error("The replica backup branch was not created.");
  return { branch: input.branch, snapshotHash: saved };
}
