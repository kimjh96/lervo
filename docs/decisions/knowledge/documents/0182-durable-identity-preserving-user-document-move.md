# ADR-0182: Durable, Identity-Preserving User Document Move

- Status: accepted
- Decision date: 2026-08-23

## Context

Path-derived identities make an ordinary rename appear as deletion plus creation, breaking evidence and navigation. Two independent transactions expose an invalid intermediate state.

## Decision

`knowledge structure move <from> <to>` creates a read-only plan for one included, current, user-owned `.md` or `.mdx` concept and an absent, policy-included destination. Reject unsafe roots or parents, generated output, and instruction-boundary crossings.

The plan binds before/after snapshots, policy and registry, content, preserved concept/source/unit identity, destination, lineage, navigation, and sidecars. Apply requires the exact plan and operation approval.

Tracked source lineage records `from`/`to`, canonical identity path, source ID, content hash, and unit-binding digest/count. The scanner applies the old identity only through valid terminal lineage, reports the new actual path, and revalidates exact bytes. Later edits create a new version under the same unit identity.

Structural compilation uses an in-memory relocated scan to plan user bytes, identity, navigation, sidecars, local projections, and the generation manifest together. The journal treats the move natively: source-present/destination-absent becomes source-absent with identical destination bytes. Pre-event failure reverses the rename and every generated output; post-event recovery accepts only the exact after-state.

Lineage chains must be linear. Delete or merge closes terminal lineage so path reuse never inherits identity. Success emits `operation=document_structure_move` with bounded digests, IDs, and counts; receipts expose only path digests.

## Consequences

Fixtures verify identity and byte preservation, navigation/query updates, no-op refresh, rollback and reproducible plans, chained moves, collisions, instruction boundaries, tampered lineage, deletion and path reuse, CLI idempotence, and path-free events.
