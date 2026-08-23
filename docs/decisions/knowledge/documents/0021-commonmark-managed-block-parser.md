# ADR-0021: CommonMark managed-block parsing

Status: `accepted`
Decision date: 2026-08-19

## Context

Marker-like text inside code must not establish Lervo ownership, and character offsets cannot safely address UTF-8 bytes after multibyte text. Before any compiler writes, a read-only parser must prove exact source boundaries. Legacy product markers require discovery but must not be mixed with or emitted as current syntax. MDX cannot receive CommonMark-level confidence from this parser alone.

## Decision

- The `@lervo/documents` parser accepts only scanner-validated `Uint8Array` input up to 4 MiB. It has no filesystem, event, or write port and never mutates input.
- Use `mdast-util-from-markdown` positions to distinguish HTML comments from code, converting all ranges to half-open UTF-8 byte offsets.
- Current markers are exactly:

```text
<!-- lervo:begin block=<blockId> schema=1 -->
<!-- lervo:end block=<blockId> -->
```

- Read legacy previous-product markers only as family `previous_product_v1`; never emit them. Import reports `legacy_marker_requires_migration`. Mixed families fail.
- A marker must be a standalone, unindented CommonMark HTML-comment line. Marker-shaped text in fenced/indented/inline code is returned as `ignoredMarkers`, not an error.
- A valid result provides block ID and half-open byte ranges for start marker, content, end marker, whole block, and all bytes outside blocks. Return outside ranges only after every structure check succeeds.
- Mark invalid: bad UTF-8, over 4 MiB, over 256 candidates, malformed/non-comment markers, nesting, duplicate IDs, mismatched or missing pairs, mixed/mismatched families, or managed content over 8 KiB.
- Results are rebuildable and ephemeral. Emit no event or persistent state, and put neither source, block content, nor block ID in telemetry. Import may carry only error codes as warnings.
- MDX does not use this parser yet and remains `marker_structure_not_verified` even when marker text exists.

## Consequences

- Example code cannot establish managed ownership.
- UTF-8 and CRLF sources receive byte-exact boundaries.
- Invalid/mixed structure yields no claim about safe outside bytes.
- ADR-0022 binds review-only patches to these ranges and source hash.
- Legacy markers remain discoverable but unwritable before explicit migration.
