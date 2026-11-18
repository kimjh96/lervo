import {
  readRepositoryHold,
  reconcileKnowledgeSupersession,
  type KnowledgeSupersessionEntry,
} from "@lervo/repository-knowledge-runtime";

import type { RepositoryReplicaPeerPort } from "./repository-replica-coordinator.js";
import { REPOSITORY_REPLICA_CAPTURE_VERSION } from "./repository-replica-capture-version.js";
import {
  applyRepositoryReplicaBundle,
  createRepositoryReplicaBundle,
} from "./repository-replica-git.js";
import {
  restoreRepositoryReplicaBackup,
  saveRepositoryReplicaBackup,
} from "./repository-replica-backup.js";
import {
  mergeRepositoryReplicaBundle,
  type RepositoryReplicaConflictPolicy,
} from "./repository-replica-merge.js";
import {
  writeRepositoryReplicaReceipt,
  type RepositoryReplicaReceipt,
} from "./repository-replica-receipt.js";
import { observeRepositoryReplicaSnapshot } from "./repository-replica-snapshot-cache.js";

/**
 * The peer port over a repository on this host. Snapshots are cached observations; bundle, apply,
 * and merge always capture freshly before they read or mutate repository bytes.
 */
export class LocalRepositoryReplicaPeer implements RepositoryReplicaPeerPort {
  captureVersion(): Promise<string> {
    return Promise.resolve(REPOSITORY_REPLICA_CAPTURE_VERSION);
  }

  /** The cached observation, with whether the owner holds this repository on this host. */
  async snapshot(repositoryRoot: string) {
    const [snapshot, hold] = await Promise.all([
      observeRepositoryReplicaSnapshot(repositoryRoot),
      readRepositoryHold(repositoryRoot),
    ]);
    return { ...snapshot, ownerHold: hold !== null };
  }

  bundle(repositoryRoot: string, expectedSnapshotHash: string) {
    return createRepositoryReplicaBundle(repositoryRoot, expectedSnapshotHash);
  }

  apply(input: {
    repositoryRoot: string;
    bundle: Uint8Array;
    expectedCurrentSnapshotHash: string;
  }) {
    return applyRepositoryReplicaBundle(input);
  }

  backup(input: {
    repositoryRoot: string;
    branch: string;
    bundle: Uint8Array | null;
    expectedSnapshotHash: string;
  }) {
    return saveRepositoryReplicaBackup(input);
  }

  restoreBackup(input: { repositoryRoot: string; branch: string }) {
    return restoreRepositoryReplicaBackup(input);
  }

  merge(input: {
    repositoryRoot: string;
    bundle: Uint8Array;
    expectedCurrentSnapshotHash: string;
    conflictPolicy?: RepositoryReplicaConflictPolicy;
  }) {
    return mergeRepositoryReplicaBundle(input);
  }

  reconcileKnowledgeSupersession(input: {
    repositoryRoot: string;
    entries: readonly KnowledgeSupersessionEntry[];
  }) {
    return reconcileKnowledgeSupersession({
      repositoryRoot: input.repositoryRoot,
      incoming: input.entries,
    });
  }

  recordReceipt(input: RepositoryReplicaReceipt): Promise<void> {
    return writeRepositoryReplicaReceipt(input);
  }
}
