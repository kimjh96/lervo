import {
  reconcileKnowledgeSupersession,
  type KnowledgeSupersessionEntry,
} from "@lervo/repository-knowledge-runtime";

import type { RepositoryReplicaPeerPort } from "./repository-replica-coordinator.js";
import {
  applyRepositoryReplicaBundle,
  createRepositoryReplicaBundle,
} from "./repository-replica-git.js";
import { mergeRepositoryReplicaBundle } from "./repository-replica-merge.js";
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
  snapshot(repositoryRoot: string) {
    return observeRepositoryReplicaSnapshot(repositoryRoot);
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

  merge(input: {
    repositoryRoot: string;
    bundle: Uint8Array;
    expectedCurrentSnapshotHash: string;
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
