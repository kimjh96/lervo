# ADR-0182: Durable, Identity-Preserving User Document Move

- Status: accepted
- Decision date: 2026-08-23

## Context

Path-derived identities make an ordinary rename look like deletion plus creation, breaking evidence and navigation. Two independent transactions expose missing intermediate state.

## Decision

knowledge structure move <from> <to> creates a read-only plan for one included current user-owned .md/.mdx concept and an absent policy-included destination. Unsafe roots/parents, generated output, and instruction-boundary crossings are rejected.

The plan binds before/after snapshots, policy/registry, content, preserved concept/source/unit identity, destination, lineage, navigation, and sidecars. Apply requires exact plan and operation approval.

Tracked source-lineage records from/to, canonical identity path, source ID, content hash, and unit-binding digest/count. Scanner applies old identity only to a valid terminal lineage while reporting the new actual path and revalidating exact bytes. Later edits produce a new version under the same unit identity.

Structural compilation runs over an in-memory relocated scan, planning user bytes, identity, navigation, sidecars, local projections, and generation manifest together. The journal treats move natively: source-present/destination-absent becomes source-absent/same destination bytes. Pre-event failure reverses rename and every generated output; post-event recovery accepts only exact after state.

Chains must be linear. Delete/merge closes terminal lineage so path reuse never inherits identity. Success emits operation=document_structure_move with only bounded digests/IDs/counts; receipt exposes path digests only.

## Consequences

Fixtures verify identity and byte preservation, navigation/query update, no-op refresh, rollback/reproducible plans, chained moves, collisions, instruction boundaries, tampered lineage, deletion/path reuse, CLI idempotence, and path-free events.
