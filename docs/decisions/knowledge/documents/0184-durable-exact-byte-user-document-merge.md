# ADR-0184: Durable Exact-Byte User Document Merge

- Status: accepted
- Decision date: 2026-08-23

## Context

Append-then-refresh exposes partial snapshots, stale concepts, and broken navigation. Automatically inserted headings, separators, or front matter would add user-unwritten meaning, and one identity must explicitly remain canonical.

## Decision

knowledge structure merge <source> <destination> creates a read-only plan for two distinct included documentation .md files, each with exactly one current user concept. MDX, instructions, generated output, and oversized results are excluded.

Composition is fixed destination_then_source: exact destination bytes followed by exact source bytes, with no inserted byte. Destination must already end in newline to preserve a CommonMark boundary, and output size must equal the sum.

Destination concept/source identity remains and gets newly extracted unit versions. Source disappears and becomes deprecated/stale with document_merged. Claims/relations are not transferred or marked used.

Content-addressed lineage binds actual/canonical identity paths, source IDs, before hashes/sizes, destination after hash/size, composition, and both prior unit digests/counts. It is not an identity alias. A moved source's terminal lineage closes document_merged in the same transaction; path reuse gets new identity, while destination move lineage remains.

The plan binds snapshots, policy/registry, exact user changes, deprecation, lineage/closure, navigation, projections, and generation manifest. Exact plan and item approval are mandatory. One durable transaction updates destination, deletes source, and changes generated outputs. Pre-event failure restores every byte; post-event recovery accepts only exact after state.

Success emits operation=document_structure_merge with bounded digests/IDs/counts. Events omit paths/content/reviewer; receipts expose path digests, destination hash, merged byte count, and concept/lineage IDs. Failures distinguish approval, staleness, structural conflict, unsafe source, limits, and rollback without partial success.

## Consequences

Fixtures verify exact order, destination identity, source deprecation, query/lint/no-op refresh, full rollback and plan reproduction, lineage tampering, moved-source closure/path reuse, dry-run privacy, approval safety, idempotence, and privacy-bounded events.
