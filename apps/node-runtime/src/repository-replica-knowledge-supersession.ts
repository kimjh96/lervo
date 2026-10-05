import {
  parseKnowledgeSupersessionReconciliation,
  type KnowledgeSupersessionEntry,
  type KnowledgeSupersessionReconciliation,
} from "@lervo/repository-knowledge-runtime";

import { RepositoryReplicaStageError } from "./repository-replica-failure.js";

/** The replica port operation that exchanges and applies superseded knowledge commits. */
export interface RepositoryReplicaKnowledgeSupersessionPort {
  reconcileKnowledgeSupersession?(input: {
    repositoryRoot: string;
    entries: readonly KnowledgeSupersessionEntry[];
  }): Promise<KnowledgeSupersessionReconciliation>;
}

/** Validates a peer's reconciliation report; malformed output fails the cycle. */
export function parseReplicaKnowledgeSupersession(
  value: unknown,
): KnowledgeSupersessionReconciliation {
  const report = parseKnowledgeSupersessionReconciliation(value);
  if (report === null)
    throw new RepositoryReplicaStageError(
      "repository_replica_supersession_invalid",
      "supersession",
      "The peer returned an invalid knowledge supersession report.",
    );
  return report;
}

const heldKey = (result: KnowledgeSupersessionReconciliation | null) =>
  (result?.held?.commits ?? []).join(",");

/**
 * Makes the convergence owner's supersession authoritative on both checkouts before any history
 * moves (ADR-0468). Each side learns the other's superseded commits and drops those at its
 * branch tip, so a host that kept them can neither push them back nor merge them in again. When
 * one side still holds superseded commits the other side lacks, the cycle stops with
 * `repository_replica_superseded_knowledge_held` instead of spreading them.
 */
export async function reconcileReplicaKnowledgeSupersession(input: {
  local: RepositoryReplicaKnowledgeSupersessionPort;
  peer: RepositoryReplicaKnowledgeSupersessionPort;
  localRoot: string;
  peerRoot: string;
}): Promise<{ droppedCommitCount: number }> {
  const reconcileLocal = (entries: readonly KnowledgeSupersessionEntry[]) =>
    input.local.reconcileKnowledgeSupersession?.({ repositoryRoot: input.localRoot, entries }) ??
    Promise.resolve(null);
  const first = await reconcileLocal([]);
  const peer =
    (await input.peer.reconcileKnowledgeSupersession?.({
      repositoryRoot: input.peerRoot,
      entries: first?.entries ?? [],
    })) ?? null;
  const known = new Set(first?.entries.map((entry) => entry.commit) ?? []);
  const local =
    peer !== null && peer.entries.some((entry) => !known.has(entry.commit))
      ? await reconcileLocal(peer.entries)
      : first;
  if (heldKey(local) !== heldKey(peer)) {
    const [side, held] =
      (local?.held?.commits.length ?? 0) >= (peer?.held?.commits.length ?? 0)
        ? ["local", local!.held!]
        : ["peer", peer!.held!];
    throw new RepositoryReplicaStageError(
      "repository_replica_superseded_knowledge_held",
      "supersession",
      `The ${side} checkout keeps ${held.commits.length} superseded knowledge commit(s) (${held.reason}); replication waits until they leave its branch.`,
    );
  }
  return {
    droppedCommitCount:
      (first?.dropped?.commitCount ?? 0) +
      (local === first ? 0 : (local?.dropped?.commitCount ?? 0)) +
      (peer?.dropped?.commitCount ?? 0),
  };
}
