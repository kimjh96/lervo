# Workstream checkpoint reconciliation

When the local and Hub workstream heads diverge, Lervo keeps the newest valid head and preserves the other. Nobody is asked to choose ([ADR-0561](../../decisions/foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md)).

## Choosing the kept head

A head is valid when it satisfies the workstream snapshot contract and hashes to its stated content hash. Of two valid heads, the one with the later `updatedAt` is kept; a tie goes to the higher revision, then to the larger content hash. Every host computes the same order from the same two heads.

The successor keeps the selected body, including its unresolved decisions and approval descriptions, and its `updatedAt`. It has `kind: successor` and `reconciliationPredecessors`, exactly two distinct `{ workstreamId, snapshotContentHash }` coordinates. The ordinary predecessor fields identify the kept parent. The successor's workstream ID and plan ID derive from the project, both parents, and the kept parent only, so two hosts that reconcile the same fork publish byte-identical revisions and the second publication is a duplicate.

Revision 1 consumes both exact current Hub heads atomically, even when they remain active; it does not claim either task completed. A changed head, missing parent, unrelated identity, malformed origin, or lost exact response fails closed. Both parents remain auditable, and duplicate historical publication cannot reopen the fork.

## Who reconciles

- Each Node runs the replication cycle. When the cycle reports `divergent`, the Node reconciles at once, logs one notice line that names the kept side, the preserved head, and the restore command, and runs the cycle again.
- `lervo workstream reconcile` does the same from a CLI-only host. It first publishes local ancestry, then prints the result. With no divergence it prints `current`.
- More than two heads, or a local head the Hub does not hold, are held as Lervo's own debt with status `held` and reason `more_than_two_heads` or `local_head_unpublished`. A failed attempt, such as against a Hub without the exact revision read, is held the same way with its failure code. Health keeps reporting `divergent_heads`, the Node logs the reason, and the next sync cycle retries. Nothing is escalated to the owner.

## Exact revision read

The Hub serves any stored revision by its exact content hash: `GET …/workstreams?snapshotContentHash=<sha256>`, with the `workstream.read` permission. The response carries the project coordinates, the revision's head metadata, `isHead`, and the snapshot. An unknown hash returns 404. A reconciler reads the other head's body this way, because a divergent read returns no snapshot. A Hub that predates this read rejects the query parameter, and the reconciler fails closed with `hub_unavailable`. Deploy the Hub before the Nodes.

## Notice and undo

Every reconciliation produces a notice `{ effect, targets, reason, crossCheck, undo }`. The Hub's exact-parent check is the independent verification: it accepts the successor only when both named parents are its current heads. The notice never contains workstream bodies.

`lervo workstream reconcile --restore <snapshot-hash>` undoes a reconciliation. It requires the local checkpoint to be the Hub's unique current head, reads the preserved head from the Hub, and publishes the next revision of the current successor with the preserved body. Only a reconciliation parent of the current successor, or an earlier revision of it, can be restored, so a restore is itself undone by restoring the previous revision. The removed `--keep`, `--apply`, and `--write` options fail with a message that names `--restore`.

`lervo workstream sync` publishes verified local ancestry and imports a unique advancing Hub checkpoint from CLI-only hosts. Both commands use the registered Node's Hub coordinates, or the owner-only convergence-host configuration; `--hub-config` selects an existing owner-only configuration explicitly. Credentials and the Hub identity are verified through the normal authenticated transport. After an interrupted reconciliation, `sync` can finish importing a Hub-committed successor without publishing it again.

## Canonical evidence and privacy

This adds no event type. Exact snapshot bytes remain in CAS, and `workstream.snapshot.recorded` with `hub_replication_import` records local adoption through the existing durable transaction. The Hub stores the successor and both immutable parents. Results and notices expose opaque parent hashes, the kept side, successor identity, and revision, never credentials or source document bodies. Reconciliation changes the selected continuation, not Git bytes, execution leases, deployment grants, or task acceptance.

The kept body's pending decisions and approval descriptions remain unresolved. Items from the preserved body remain in its canonical parent snapshot, not as new grants.

See [ADR-0456](../../decisions/coordination/sync/0456-hand-off-repositories-atomically-with-a-writer-lease.md) and [ADR-0201](../../decisions/coordination/sync/0201-repository-scoped-workstream-replication.md).
