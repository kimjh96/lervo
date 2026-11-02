# ADR-0183: Durable CommonMark Heading-Subtree Split

- Status: accepted
- Decision date: 2026-08-23
- Amended by: [ADR-0561](../../foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md) (independent cross-check replaces the operation approval)

> **Amended (2026-11-02).** Under [ADR-0561](../../foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md), `--apply` no longer takes an operation approval. An independent cross-check of the exact plan must agree; the split then lands as its own `Lervo Knowledge` commit that `lervo knowledge revert <commit>` undoes.

## Context

Splitting long user Markdown requires parser-defined structure, exact bytes, one transaction, preserved source identity, and a new destination identity. Regex can misinterpret fenced text as headings.

## Decision

`knowledge structure split <source> <destination> --at-heading 'heading:Parent > Child'` creates a read-only plan for one included documentation `.md` file with one current user concept and an absent included `.md` destination. Exclude MDX, instructions, generated output, unsafe paths, and symlink parents.

A fixed CommonMark parser requires exactly one root-heading ancestry locator. The selected range starts at that heading and ends before the next heading of the same or higher level; fenced lookalikes do not count. The destination is exactly the selected bytes and the source is exactly the remainder. No formatting, heading, front-matter, or newline changes are allowed, and both outputs must be nonempty.

The source retains its identity; the destination receives a path-derived identity. Units are re-extracted, and old semantic evidence may become stale without automatic reassignment. Content-addressed lineage binds paths, identity, before/after hashes, exact locator/range, and prior unit digest/count. Split is not a move alias.

The plan binds snapshots, policy and registry, user outputs, lineage, navigation, projections, and generation manifest. The exact plan and item approval are mandatory. One durable transaction updates the source, creates the destination, and changes generated files. Pre-event failure restores the source and removes or restores every output; post-event recovery accepts only exact after-bindings.

Success emits `operation=document_structure_split` with bounded IDs, digests, and counts, excluding path, heading, content, and reviewer. The receipt contains only path digests, output hashes, extracted byte count, and concept/lineage IDs.

## Consequences

Fixtures verify exact nested partitioning, identities, query/navigation, immediate no-op refresh, fence and ambiguity rejection, complete rollback and reproducibility, dry-run privacy, approval safety, lint and idempotence, and path-free events.
