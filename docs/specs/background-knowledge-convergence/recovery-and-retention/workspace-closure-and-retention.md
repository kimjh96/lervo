# Workspace closure and retention

## Closure

After verified integration, an integrator closes its clean checkout under its current lease: `active` → `sealing` → `sealed` → `integrated`. Its exact seal and canonical completed integration attempt provide evidence. Only integrator workspaces permit the final direct transition; workers retain the existing queued integration lifecycle. Closing a writer session proves no current Lervo writer, without inferring absence of unmanaged work.

## Cleanup

Each cycle retires at most eight convergence checkouts on every host, owner or not, under the repository's knowledge worker lock ([ADR-0518](../../../decisions/operations/storage/0518-retire-settled-convergence-checkouts-on-every-host.md)). A checkout qualifies when its record is the exact private path for its assignment, lease generation, and execution kind, and one of these holds:

- `obligation_settled`: the obligation recorded its terminal event and the assignment holds no lease.
- `assignment_closed`: the assignment is cancelled, or failed after its final permitted attempt, and holds no lease.
- `lease_superseded`: the checkout never sealed and a later lease generation replaced it.

Retirement fences the record as `recovery_required` with reason `convergence_retirement`, removes the worktree with marker-checked forced Git removal, and records `removed`. Uncommitted bytes in the checkout are discarded: a seal binds only committed bytes, only Lervo writes under the private root, and drafts and verification results stay in CAS. Neither target reachability nor the current delegation is required, so ADR-0482 absorption and delegation renewal cannot strand a checkout. A reopenable failed attempt, and a sealed checkout of an open obligation, stay until their lifecycle settles. Cleanups journaled by earlier releases finish through exact journal recovery. `lervo state prune` never inventories these worktrees.

## Compaction and archival

At 256 assignment projections, compaction preserves the latest 128 and every active, unresolved, dependent, or remaining workspace consumer. At most sixteen canonically terminal convergence assignments are archived per cycle.

Under the coordination lock, exact original file bytes enter private CAS and the canonical archive event is appended before projection removal. Append failure retains the projection; crash replay reuses the same event coordinate.

Ordinary assignments, unresolved identities, canonical events, and private proof remain intact. Existing hard capacity limits stop unresolved growth.
