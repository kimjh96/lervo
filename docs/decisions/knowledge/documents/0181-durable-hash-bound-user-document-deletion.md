# ADR-0181: Durable, Hash-Bound User Document Deletion

- Status: accepted
- Decision date: 2026-08-23

## Context

Ordinary deletion cannot bind current bytes, ownership, concepts, and human approval, and would leave nonexistent publications queryable. Move/split/merge also require distinct identity and navigation contracts.

## Decision

lervo knowledge structure delete <relative-markdown-path> creates only a read-only plan for an included regular .md/.mdx user-owned file registered to at least one current nondeprecated concept. Lervo/generated/unregistered/unsafe paths are rejected.

The plan binds snapshot, policy, registry digest, exact bytes, linked concepts, sidecar before/after hashes, and a delete operation. Apply requires exact plan ID and every operation approval hash.

Apply removes the source and marks linked sidecars publicationStatus=deprecated, freshness=stale, deprecation.kind=document_deleted. It never infers claim truth or replacement. The durable journal renames the source to backup with after=null. Pre-event failure restores every byte; post-event recovery verifies exact absence/output and cleans only transaction state.

If a generated category loses its last active user document, refresh produces a deprecated tombstone. Query/lint exclude deprecated concepts from active publication. Deleting a moved document closes terminal lineage in the same transaction so path reuse gets a new identity.

Success records knowledge.materialization.applied operation=document_structure_delete with bounded digests/counts but no raw path/content/identity; receipts use path digest. Failures distinguish approval, stale plan, ownership conflict, apply/recovery/rollback and never record partial success.

## Consequences

Fixtures verify dry-run privacy/nonmutation, wrong-approval safety, exact deletion/deprecation/lint/refresh/query, bounded events, byte-perfect rollback and plan reproducibility, and rejection of unregistered/generated/unsafe targets.
