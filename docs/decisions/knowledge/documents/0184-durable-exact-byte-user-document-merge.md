# ADR-0184: Durable Exact-Byte User Document Merge

- Status: accepted
- Decision date: 2026-08-23

## Context

Append-then-refresh exposes partial snapshots, stale concepts, and broken navigation. Inserting headings, separators, or front matter adds meaning the user did not write, and one identity must explicitly remain canonical.

## Decision

`knowledge structure merge <source> <destination>` creates a read-only plan for two distinct, included documentation `.md` files, each with exactly one current user concept. Exclude MDX, instructions, generated output, and oversized results.

Composition is fixed as `destination_then_source`: exact destination bytes followed by exact source bytes, with no inserted byte. The destination must already end with a newline to preserve a CommonMark boundary, and output size must equal the sum of both inputs.

The destination concept/source identity remains and receives newly extracted unit versions. The source disappears and becomes deprecated/stale with `document_merged`. Claims and relations are neither transferred nor marked used.

Content-addressed lineage binds actual and canonical identity paths, source IDs, before hashes/sizes, destination after hash/size, composition, and both prior unit digests/counts. It is not an identity alias. A moved source's terminal lineage closes as `document_merged` in the same transaction, so path reuse receives a new identity; destination move lineage remains open.

The plan binds snapshots, policy and registry, exact user changes, deprecation, lineage and closure, navigation, projections, and generation manifest. The exact plan and item approval are mandatory. One durable transaction updates the destination, deletes the source, and changes generated outputs. Pre-event failure restores every byte; post-event recovery accepts only the exact after-state.

Success emits `operation=document_structure_merge` with bounded digests, IDs, and counts. Events exclude paths, content, and reviewer; receipts expose path digests, destination hash, merged byte count, and concept/lineage IDs. Failures distinguish approval, staleness, structural conflict, unsafe source, limits, and rollback errors without partial success.

## Consequences

Fixtures verify exact ordering, destination identity, source deprecation, query/lint/no-op refresh, full rollback and plan reproduction, lineage tampering, moved-source closure and path reuse, dry-run privacy, approval safety, idempotence, and privacy-bounded events.
