import type { RepositoryReplicaSnapshot } from "@lervo/sync";

import type { RepositoryReplicaCaptureVersionPort } from "./repository-replica-capture-compatibility.js";
import type { RepositoryReplicaKnowledgeSupersessionPort } from "./repository-replica-knowledge-supersession.js";
import type {
  RepositoryReplicaConflictPolicy,
  RepositoryReplicaMergeResult,
} from "./repository-replica-merge.js";
import type { RepositoryReplicaReceipt } from "./repository-replica-receipt.js";

/**
 * A side's snapshot as its own host reports it. `ownerHold` is whether the owner holds that
 * repository on that host (ADR-0561); a side that does not report it counts as held.
 */
export type RepositoryReplicaSideSnapshot = RepositoryReplicaSnapshot & { ownerHold?: boolean };

/** One side of a repository replica, as the coordinator drives it: this host or the SSH peer. */
export interface RepositoryReplicaPeerPort
  extends RepositoryReplicaKnowledgeSupersessionPort, RepositoryReplicaCaptureVersionPort {
  snapshot(repositoryRoot: string): Promise<RepositoryReplicaSideSnapshot>;
  bundle(repositoryRoot: string, expectedSnapshotHash: string): Promise<Uint8Array>;
  apply(input: {
    repositoryRoot: string;
    bundle: Uint8Array;
    expectedCurrentSnapshotHash: string;
    allowHistoryReplacement?: boolean;
  }): Promise<RepositoryReplicaSnapshot>;
  recordReceipt(input: RepositoryReplicaReceipt): Promise<void>;
  /**
   * Saves this side's exact snapshot to a backup branch in its own repository (ADR-0561). The
   * local side can also save the peer's side from a bundle; the peer saves only its own.
   */
  backup?(input: {
    repositoryRoot: string;
    branch: string;
    bundle: Uint8Array | null;
    expectedSnapshotHash: string;
  }): Promise<{ branch: string; snapshotHash: string }>;
  /** ADR-0561 undo: puts a saved backup branch back into this side's repository. */
  restoreBackup?(input: {
    repositoryRoot: string;
    branch: string;
  }): Promise<RepositoryReplicaSnapshot>;
  /** Local side only: merges the peer's bundle when both sides changed. */
  merge?(input: {
    repositoryRoot: string;
    bundle: Uint8Array;
    expectedCurrentSnapshotHash: string;
    conflictPolicy?: RepositoryReplicaConflictPolicy;
  }): Promise<RepositoryReplicaMergeResult>;
}
