# ADR-0021: CommonMark managed-block parsing

Status: `accepted`
Decision date: 2026-08-19

## Context

Marker-like text in code must not establish Lervo ownership, and character offsets cannot safely address UTF-8 bytes following multibyte text. A read-only parser must prove exact source boundaries before any compiler writes. Legacy product markers must remain discoverable but cannot be mixed with or emitted as current syntax. This parser alone cannot give MDX CommonMark-level confidence.

## Decision

- The `@lervo/documents` parser accepts only scanner-validated `Uint8Array` input up to 4 MiB. It has no filesystem, event, or write port and never mutates input.
- Use `mdast-util-from-markdown` positions to distinguish HTML comments from code, converting all ranges to half-open UTF-8 byte offsets.
- Current markers are exactly:

```text
<!-- lervo:begin block=<blockId> schema=1 -->
<!-- lervo:end block=<blockId> -->
```

- Read legacy previous-product markers only as family `previous_product_v1`; never emit them. Import reports `legacy_marker_requires_migration`. Mixed families fail.
- A marker must be a standalone, unindented CommonMark HTML-comment line. Return marker-shaped text in fenced, indented, or inline code as `ignoredMarkers`, not an error.
- A valid result includes the block ID and half-open byte ranges for the start marker, content, end marker, whole block, and all bytes outside blocks. Return outside ranges only after every structural check succeeds.
- Mark input invalid for bad UTF-8, size above 4 MiB, more than 256 candidates, malformed or non-comment markers, nesting, duplicate IDs, mismatched or missing pairs, mixed or mismatched families, or managed content above 8 KiB.
- Results are ephemeral and rebuildable. Emit no event or persistent state. Telemetry contains neither source, block content, nor block ID; import may carry only error codes as warnings.
- MDX does not use this parser yet and remains `marker_structure_not_verified` even when marker text exists.

## Consequences

- Example code cannot establish managed ownership.
- UTF-8 and CRLF sources receive byte-exact boundaries.
- Invalid or mixed structure yields no claim about safe outside bytes.
- ADR-0022 binds review-only patches to these ranges and the source hash.
- Legacy markers remain discoverable but unwritable until explicitly migrated.
