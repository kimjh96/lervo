# Local data and state lifecycle

Status: `active`
As of: 2026-08-25

## Storage boundary

Gitignored `.lervo/data` contains durable local evidence: the event/outbox database, content-addressed artifacts, workforce records, and Node policy or replay databases. Gitignored `.lervo/state` contains only rebuildable projections, caches, observations, temporary transactions, and readiness snapshots. Repository snapshots exclude both roots.

Storage opening creates real owner-only roots, rejects symbolic links, and atomically moves legacy `events.sqlite`, Node policy and remote-command replay databases, their SQLite sidecars, CAS, and workforce entries from state to data. Each move is restartable.

If both locations exist, Lervo removes only a project-bound, integrity-checked zero-event database or a file-empty directory; it may promote the non-empty legacy side when the durable side is verified empty. Active SQLite sidecars, two non-empty copies, invalid stores, and symbolic links fail closed without overwriting either copy.

## Bounded projections

Knowledge compilation writes only `.lervo/state/knowledge/current/inventory.json`, `source-units.json`, and `impact.json`. Inventory is compact JSON. Source units retain counts, kinds, and a binding digest rather than complete historical units. `lervo migrate knowledge` turns every prior inventory, source-unit, and impact generation into an exact-hash delete operation.

Canonical claims and relations carry stable source-unit IDs. A changed or missing current unit remains observable without historical cache files. Legacy version-only evidence becomes `unknown` after cache deletion; Lervo does not promote a derived cache into canonical evidence.

## Reset and reconstruction

`lervo state status` returns a non-approval inspection and counts paths and bytes without content hashing. It never presents a reset plan ID. `lervo state reset` hashes files by stream only when producing an exact approval plan, rechecks the plan before applying it, atomically detaches the state tree, and removes it while preserving `.lervo/data`.

When current workstream state is missing, Lervo validates the latest `workstream.snapshot.recorded` event, loads the exact CAS artifact, validates canonical snapshot bytes, and recreates the projection atomically. Knowledge, search, environment, terminal, and health projections rebuild through their normal migration, query, hook, or runtime entrypoints. A clean clone rebuilds without a Hub from tracked Markdown, repository state, skill definitions, verification sources, manifests, and other canonical repository bytes.

## Failure meaning

- Conflicting or symbolic durable paths: stop before opening storage.
- Changed reset inventory: reject the stale approval and produce a new plan.
- Missing workstream CAS artifact: fail closed; do not invent continuation state.
- Deleted derived state: no loss of canonical evidence; rebuild on demand.

See [ADR-0213](../../decisions/operations/storage/0213-deletable-derived-state-boundary.md).
