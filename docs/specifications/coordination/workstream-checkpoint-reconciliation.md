# Workstream checkpoint reconciliation

The command first produces an exact plan. Applying requires `--apply <plan-id> --write` and preserves the selected continuation body, including unresolved decisions and approval descriptions. The other continuation remains immutable history; selection neither resolves its pending items nor confers its authority.

The successor retains `kind: successor` and adds `reconciliationPredecessors`: exactly two distinct `{ workstreamId, snapshotContentHash }` coordinates. Ordinary predecessor fields identify the selected parent. Revision 1 atomically consumes both exact current Hub heads, even when active, without claiming either task completed. A changed head, missing parent, unrelated identity, malformed origin, or lost exact response fails closed. Both parents remain auditable; duplicate historical publication cannot reopen the fork.

## Synchronization and transport

`lervo workstream sync` publishes verified local ancestry and imports a unique advancing Hub checkpoint from CLI-only hosts. It never selects a divergent head. After an interrupted apply, `sync` can finish importing a Hub-committed successor without publishing it again.

Both commands use the registered Node's Hub coordinates or the owner-only convergence-host configuration. `--hub-config` explicitly selects an existing owner-only configuration. Credentials and Hub identity are verified through the normal authenticated transport. Runtime service readiness alone does not prove that another host's latest checkpoint reached the Hub.

Deploy the compatible Hub and every Node reading this repository before publishing a reconciliation origin; older readers reject the added field.

## Canonical evidence and privacy

Reconciliation adds no event type. Exact snapshot bytes remain in CAS. `workstream.snapshot.recorded` with `hub_replication_import` records local adoption through the existing durable transaction. The Hub stores the successor and both immutable parents.

Plans and receipts expose opaque parent hashes, the selected side, successor identity, and revision, never credentials or source document bodies. Reconciliation changes the selected continuation, not Git bytes, execution leases, deployment grants, or task acceptance.

Selected pending decisions and approval descriptions remain unresolved. Items from the unselected body remain in its canonical parent snapshot, not as new grants. A caller must inspect the exact parents when choosing the continuation.

See [ADR-0456](../../decisions/coordination/sync/0456-hand-off-repositories-atomically-with-a-writer-lease.md) and [ADR-0201](../../decisions/coordination/sync/0201-repository-scoped-workstream-replication.md).
