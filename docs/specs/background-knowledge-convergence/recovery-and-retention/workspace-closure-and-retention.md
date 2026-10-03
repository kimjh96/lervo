# Workspace closure and retention

## Closure

After verified integration, an integrator closes its clean checkout under its current lease: `active` → `sealing` → `sealed` → `integrated`. Its exact seal and canonical completed integration attempt provide evidence. Only integrator workspaces permit the final direct transition; workers retain the existing queued integration lifecycle. Closing a writer session proves no current Lervo writer, without inferring absence of unmanaged work.

## Cleanup

Startup may clean at most eight terminal convergence workspaces per cycle through existing exact non-force cleanup plans and journal recovery. Eligibility requires the private managed path, matching delegation/target, terminal baseline, no assignment lease or writer, clean marker/head/tree, completed integration evidence, reachability, and observed quiescence. The attempt may bind its source workspace or its own integrator workspace.

Active, failed, uncertain, foreign, and user-owned workspaces remain protected. No forced deletion or implicit discard is introduced.

## Compaction and archival

At 256 assignment projections, compaction preserves the latest 128 and every active, unresolved, dependent, or remaining workspace consumer. At most sixteen canonically terminal convergence assignments are archived per cycle.

Under the coordination lock, exact original file bytes enter private CAS and the canonical archive event is appended before projection removal. Append failure retains the projection; crash replay reuses the same event coordinate.

Ordinary assignments, unresolved identities, canonical events, and private proof remain intact. Existing hard capacity limits stop unresolved growth.
