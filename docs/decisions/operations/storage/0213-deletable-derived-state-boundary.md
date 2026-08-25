# ADR-0213: Deletable Derived State Boundary

Status: accepted
Date: 2026-08-25

## Context

`.lervo/state` mixed rebuildable projections with the event database, CAS, and workforce registry. Knowledge compilation also retained a complete source-unit snapshot for every migration. This consumed roughly 599 MiB in this repository, including thirty copies of a 500,000-line projection, while the historical reader could no longer load those files within its limits. Deleting state would therefore lose canonical evidence.

## Decision

- Durable local events, CAS objects, workforce records, Node policy snapshots, and remote-command replay receipts live under gitignored `.lervo/data`. Only rebuildable projections and caches live under `.lervo/state`.
- Opening storage atomically relocates legacy durable entries, including policy and replay SQLite sidecars, from state to data. Migration is restartable. If a completed old runtime recreated a second event store or CAS tree, Lervo discards only a verified empty compatibility copy. Non-empty, active, invalid, or symbolic-link conflicts fail closed.
- Knowledge compilation writes one compact current inventory, one source-unit count and binding summary, and one impact report. Migration deletes prior inventory, full source-unit, and impact generations through exact-hash durable operations. Historical source-unit files are not evidence; canonical sidecars carry stable unit IDs.
- A missing workstream projection is reconstructed from the latest hash-chained event and exact CAS artifact. `lervo state reset` is plan-first, content-bound, and preserves `.lervo/data`.
- Repository snapshots exclude both runtime roots. A clean clone rebuilds projections from tracked Markdown, manifests, verification sources, skills, and other canonical repository bytes. Local event-derived projections rebuild when local durable data exists.

## Consequences

`.lervo/state` may be deleted without losing durable evidence. Runtime growth is bounded by current projections rather than migration count. After cache deletion, legacy version-only knowledge evidence becomes unknown, which is more accurate than treating derived history as canonical. Event database retention and segmentation remain an independent durable-data lifecycle concern.

## Verification

Storage relocation and conflict tests, full state-reset/CAS preservation, workstream reconstruction, compact projection assertions, exact legacy cleanup planning, migration idempotence, and knowledge lint cover this decision.
