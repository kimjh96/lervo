# ADR-0181: Durable, Hash-Bound User Document Deletion

- Status: accepted
- Decision date: 2026-08-23

## Context

Ordinary deletion cannot bind current bytes, ownership, concepts, and human approval, and may leave nonexistent publications queryable. Move, split, and merge operations need separate identity and navigation contracts.

## Decision

`lervo knowledge structure delete <relative-markdown-path>` creates a read-only plan only for an included, regular `.md` or `.mdx` user-owned file registered to at least one current, nondeprecated concept. It rejects Lervo-owned, generated, unregistered, and unsafe paths.

The plan binds the snapshot, policy, registry digest, exact bytes, linked concepts, sidecar before-and-after hashes, and delete operation. Apply requires the exact plan ID and every operation approval hash.

Apply deletes the source, retires every normalization lifecycle record owned by that exact source path, and changes linked sidecars to `publicationStatus=deprecated`, `freshness=stale`, and `deprecation.kind=document_deleted`. The reviewed plan and receipt list the retired records. Apply neither infers claim truth nor selects a replacement. The durable journal renames each deleted path to a backup with `after=null`. A pre-event failure restores every byte. Post-event recovery verifies exact absence and output, then removes only transaction state.

If a generated category loses its last active user document, refresh creates a deprecated tombstone. Query and lint exclude deprecated concepts from active publication. Deleting a moved document closes terminal lineage in the same transaction, so reuse of its path creates a new identity.

Success records `knowledge.materialization.applied` with `operation=document_structure_delete` and bounded digests and counts, excluding raw path, content, and identity. Receipts use a path digest. Failures distinguish approval, stale plan, ownership conflict, apply, recovery, and rollback errors and never record partial success.

## Consequences

Fixtures verify dry-run privacy and nonmutation, wrong-approval safety, exact deletion and deprecation, lint/refresh/query behavior, bounded events, byte-perfect rollback, plan reproducibility, and rejection of unregistered, generated, and unsafe targets.
