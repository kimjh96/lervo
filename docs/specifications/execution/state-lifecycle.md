# Local data and state lifecycle

Status: `active`
As of: 2026-08-26

## Storage boundary

Gitignored `.lervo/data` contains durable local evidence: the event/outbox database, content-addressed artifacts, workforce records, and Node policy or replay databases. Gitignored `.lervo/state` contains only rebuildable projections, caches, observations, temporary transactions, and readiness snapshots. Repository snapshots exclude both roots.

Storage opening creates real owner-only roots, rejects symbolic links, and atomically moves legacy `events.sqlite`, Node policy and remote-command replay databases, their SQLite sidecars, CAS, and workforce entries from state to data. Each move is restartable.

If both locations exist, Lervo removes only a project-bound, integrity-checked zero-event database or a file-empty directory; it may promote the non-empty legacy side when the durable side is verified empty. Active SQLite sidecars, two non-empty copies, invalid stores, and symbolic links fail closed without overwriting either copy.

## Bounded projections

Knowledge compilation writes only `.lervo/state/knowledge/current/inventory.json`, `source-units.json`, and `impact.json`. Inventory is compact JSON. Source units retain counts, kinds, and a binding digest rather than complete historical units. `lervo migrate knowledge` turns every prior inventory, source-unit, and impact generation into an exact-hash delete operation.

Canonical claims and relations carry stable source-unit IDs. A changed or missing current unit remains observable without historical cache files. Legacy version-only evidence becomes `unknown` after cache deletion; Lervo does not promote a derived cache into canonical evidence.

## Reset and reconstruction

`lervo state status` performs non-approval inspection and counts paths and bytes without content hashing. It never presents a reset plan ID. `lervo state reset` hashes files by stream only when producing an exact approval plan, rechecks the plan before applying it, atomically detaches the state tree, and removes it while preserving `.lervo/data`.

When current workstream state is missing, Lervo validates the latest `workstream.snapshot.recorded` event, loads the exact CAS artifact, validates canonical snapshot bytes, and atomically recreates the projection. Knowledge, search, environment, terminal, and health projections rebuild through their normal migration, query, hook, or runtime entrypoints. A clean clone rebuilds without a Hub from tracked Markdown, repository state, skill definitions, verification sources, manifests, and other canonical repository bytes.

## Typed retention and selective pruning

| Class | Owner and identity | Retention and privacy | Reconstruction and failure meaning |
| --- | --- | --- | --- |
| `replace_current` | Producing subsystem; stable current-projection path | Always protected; report only counts and bytes | Replaced by the normal producer. Missing or unknown ownership grants no deletion authority. |
| `rebuildable_cache` | Knowledge/search producer; file path plus exact content hash | Eligible after 14 days, above 128 artifacts, or above 256 MiB. A normalization candidate joins this class only when a tracked lifecycle record binds its ID. Paths and hashes stay out of public output and events. | Rebuilt by migration, query, or normalization. Failure requires recomputation, never evidence loss. |
| `pending_review` | Review lifecycle; unresolved candidate ID | Always protected regardless of age, count, or bytes; body and path are private | The owning review accepts or rejects it. Missing authority means pending, not disposable. |
| `completed_workspace` | Deliberation lifecycle; workspace ID with durable completion event | Eligible after 7 days, above 8 workspaces, or above 128 MiB, only without an active checkpoint, lease, transaction, or recovery marker | Durable events and CAS retain evidence. Missing completion or active state requires recovery protection. |
| `bounded_observation` | Search/environment producer; observation file and hash | Eligible after 30 days, above 32 observations, or above 32 MiB; report aggregates only | Recreated by its observation entrypoint. Removal makes historical derived diagnostics unavailable. |
| `recovery_required` | Transaction or execution owner; workspace/marker identity | Always protected; status exposes only a bounded reason code | Explicit recovery must finish or roll back before pruning. Missing or malformed recovery evidence fails closed. |

`lervo state prune` uses a 100,000-file and 8 GiB inventory independently of the smaller reset limit. Planning hashes state, returns class totals and path digests without bodies or raw paths, and names exact eligible operations. Apply requires the current plan ID and rejects changed bytes. It detaches targets under a journaled `.lervo/.state-prune-*` tombstone, records `state.pruned`, then removes the tombstone; event failure rolls back. An interrupted tombstone blocks new plans until `--recover` uses durable event evidence to choose cleanup or restoration.

The Node health projection can report eligibility, but unattended cleanup is not authorized. It remains disabled until the runtime passes the interactive authorization, protection, race, reconstruction, and failure-injection contract.

## Failure meaning

- Conflicting or symbolic durable paths: stop before opening storage.
- Changed reset inventory: reject the stale approval and produce a new plan.
- Changed prune inventory: reject the stale approval without moving targets.
- Interrupted prune: block further pruning and require explicit recovery; absence of a success event restores detached targets.
- Missing workstream CAS artifact: fail closed; do not invent continuation state.
- Deleted derived state: no canonical evidence is lost; rebuild on demand.

See [ADR-0213](../../decisions/operations/storage/0213-deletable-derived-state-boundary.md) and [ADR-0219](../../decisions/operations/storage/0219-typed-derived-state-retention.md).
