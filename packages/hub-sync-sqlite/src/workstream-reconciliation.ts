import { HubWorkstreamReplicationError } from "@lervo/hub-sync";
import { workstreamReconciliationPredecessors, type WorkstreamSnapshot } from "@lervo/schemas";
import type { RevisionRow } from "./workstream-revision.js";

/** The publication transaction must consume exactly the two reviewed current heads. */
export function reconciliationHeads(
  snapshot: WorkstreamSnapshot,
  previousHash: string | null,
  heads: RevisionRow[],
): RevisionRow[] {
  if (snapshot.revision !== 1 || snapshot.origin.reconciliationPredecessors === undefined)
    return [];
  const parents = workstreamReconciliationPredecessors(snapshot);
  if (
    parents === null ||
    previousHash !== snapshot.origin.predecessorSnapshotContentHash ||
    heads.length !== 2 ||
    !heads.every((head) =>
      parents.some(
        (parent) =>
          parent.snapshotContentHash === head.snapshot_content_hash &&
          parent.workstreamId === head.workstream_id,
      ),
    )
  )
    throw new HubWorkstreamReplicationError(
      "workstream_conflict",
      "Reconciliation must bind exactly both current workstream heads.",
    );
  return heads;
}
