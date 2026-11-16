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

/** A settled exchange is trusted this long before the peer is asked again (ADR-0570). */
const SETTLED_EXCHANGE_FRESH_FOR_MS = 15 * 60_000;

/**
 * Runs each cycle's supersession exchange and remembers, per replica, the last one that changed
 * nothing: no commit dropped or held on either side and no entry the local side lacked. While both
 * sides still show that same equal snapshot and the local ledger still yields the same result,
 * asking the peer again would return the same answer, so the peer request is skipped. Equal sides
 * move no history, and a peer ledger change without a snapshot change is picked up once the
 * memory expires.
 */
export class ReplicaKnowledgeSupersessionExchange {
  private readonly settled = new Map<string, { key: string; at: number }>();

  constructor(private readonly now: () => number) {}

  async exchange(input: {
    replicaId: string;
    local: RepositoryReplicaKnowledgeSupersessionPort;
    peer: RepositoryReplicaKnowledgeSupersessionPort;
    localRoot: string;
    peerRoot: string;
    /** The local and peer snapshot hashes this cycle observed. */
    snapshotHashes: readonly [string, string];
  }): Promise<{ droppedCommitCount: number }> {
    const [localSnapshotHash, peerSnapshotHash] = input.snapshotHashes;
    const equal = localSnapshotHash === peerSnapshotHash;
    const key = (local: KnowledgeSupersessionReconciliation | null) =>
      JSON.stringify([localSnapshotHash, local?.entries ?? []]);
    const remembered = this.settled.get(input.replicaId);
    const result = await reconcileReplicaKnowledgeSupersession({
      ...input,
      peerAgrees: (local) =>
        equal &&
        remembered !== undefined &&
        this.now() - remembered.at < SETTLED_EXCHANGE_FRESH_FOR_MS &&
        local?.dropped == null &&
        local?.held == null &&
        remembered.key === key(local),
    });
    if (result.exchange === "settled" && equal)
      this.settled.set(input.replicaId, { key: key(result.local), at: this.now() });
    else if (result.exchange !== "skipped") this.settled.delete(input.replicaId);
    return { droppedCommitCount: result.droppedCommitCount };
  }
}

/**
 * Makes the convergence owner's supersession authoritative on both checkouts before any history
 * moves (ADR-0468). Each side learns the other's superseded commits and drops those at its
 * branch tip, so a host that kept them can neither push them back nor merge them in again. When
 * one side still holds superseded commits the other side lacks, the cycle stops with
 * `repository_replica_superseded_knowledge_held` instead of spreading them. `peerAgrees` lets the
 * caller skip the peer request when an earlier exchange already settled this exact local result.
 */
export async function reconcileReplicaKnowledgeSupersession(input: {
  local: RepositoryReplicaKnowledgeSupersessionPort;
  peer: RepositoryReplicaKnowledgeSupersessionPort;
  localRoot: string;
  peerRoot: string;
  peerAgrees?(local: KnowledgeSupersessionReconciliation | null): boolean;
}): Promise<{
  droppedCommitCount: number;
  /** `settled`: the peer was asked and nothing changed; `skipped`: the peer was not asked. */
  exchange: "skipped" | "settled" | "changed";
  /** The local side's own result before it learned anything from the peer. */
  local: KnowledgeSupersessionReconciliation | null;
}> {
  const reconcileLocal = (entries: readonly KnowledgeSupersessionEntry[]) =>
    input.local.reconcileKnowledgeSupersession?.({ repositoryRoot: input.localRoot, entries }) ??
    Promise.resolve(null);
  const first = await reconcileLocal([]);
  if (input.peerAgrees?.(first) === true)
    return { droppedCommitCount: 0, exchange: "skipped", local: first };
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
  const droppedCommitCount =
    (first?.dropped?.commitCount ?? 0) +
    (local === first ? 0 : (local?.dropped?.commitCount ?? 0)) +
    (peer?.dropped?.commitCount ?? 0);
  const unchanged =
    droppedCommitCount === 0 && local === first && first?.held == null && peer?.held == null;
  return { droppedCommitCount, exchange: unchanged ? "settled" : "changed", local: first };
}
