# ADR-0183: Durable CommonMark Heading-Subtree Split

- Status: accepted
- Decision date: 2026-08-23

## Context

Splitting long user Markdown needs parser-defined structure, exact bytes, one transaction, preserved source identity, and a new destination identity. Regex can mistake fenced text for headings.

## Decision

knowledge structure split <source> <destination> --at-heading 'heading:Parent > Child' creates a read-only plan for one included documentation .md with one current user concept and an absent included .md destination. MDX, instructions, generated output, unsafe paths, and symlink parents are excluded.

A fixed CommonMark parser requires exactly one root heading ancestry locator. The range begins at that heading and ends before the next same-or-higher heading; fenced lookalikes do not count. Destination is exactly selected bytes and source exactly the remainder—no formatting, heading/front-matter/newline changes—and both must be nonempty.

Source retains identity; destination gets a path-derived identity. Units are re-extracted and old semantic evidence may become stale without automatic reassignment. Content-addressed lineage binds paths, identity, before/after hashes, exact locator/range, and prior unit digest/count; split is not a move alias.

The plan binds snapshots, policy/registry, user outputs, lineage, navigation, projections, and generation manifest. Exact plan and item approval are mandatory. One durable transaction updates source, creates destination, and changes generated files. Pre-event failure restores source and removes/restores all outputs; post-event recovery accepts only exact after bindings.

Success emits operation=document_structure_split with bounded IDs/digests/counts, no path/heading/content/reviewer. Receipt contains only path digests, output hashes, extracted byte count, and concept/lineage IDs.

## Consequences

Fixtures verify exact nested partition, identities, query/navigation, immediate no-op refresh, fence/ambiguity rejection, complete rollback/reproducibility, dry-run privacy, approval safety, lint/idempotence, and path-free events.
