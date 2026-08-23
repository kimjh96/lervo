# ADR-0022: Byte-preserving managed-block patch candidates

Status: `accepted`
Decision date: 2026-08-19

## Context

Parser-verified block boundaries do not authorize immediate writes. Reviewers need a source-bound candidate showing what changes and demonstrating preservation of user-owned bytes. Stale output must not apply after source changes. Metadata should contain hashes, while full output bytes remain locally reviewable rather than copied into events.

## Decision

`@lervo/documents` exposes filesystem-free `createManagedBlockPatchCandidate`, accepting scanner-verified source path/hash/count/bytes, a current block ID, and replacement bytes. It:

1. Verifies source digest and byte count.
2. Requires a fully valid CommonMark parse with exactly one target block.
3. Requires marker family `lervo_v1`; legacy markers are read-only.
4. Replaces only the content byte range.
5. Re-parses output and proves unchanged block order, IDs, families, and marker bytes.
6. Proves all bytes before/after the target content unchanged and content equal to replacement.

Replacement must be valid UTF-8 and at most 8 KiB. Empty content is allowed. Reject content that breaks the standalone end marker, injects managed markers, changes structure, or equals existing bytes.

Return:

- `ManagedBlockPatchCandidateArtifact`: canonical JSON with source/parser coordinates, original range/content hash, replacement hash/count, output hash/count/range, and verification constants.
- `outputBytes`: full review/apply bytes bound by output hash but absent from JSON/events.

Derive candidate and artifact IDs from canonical content, not time. Fix `disposition=review_required` and `writesAllowed=false`. Set `onlyTargetContentChanged`, `markerBytesUnchanged`, and `outputStructureValid` true only after direct proof.

This stage writes no file, CAS object, or event and creates no approval/application state. Metadata contains hashes and byte coordinates only—never source, replacement, or absolute paths.

| Code | Meaning |
| --- | --- |
| `invalid_patch_request` | Invalid block ID or relative path. |
| `source_changed` | Bytes no longer match requested digest/count. |
| `source_structure_invalid`, `block_not_found` | Ownership boundary or target is not verified. |
| `legacy_marker_not_writable` | Explicit migration is required. |
| `replacement_invalid_utf8`, `replacement_too_large`, `no_changes` | Invalid or ineffective replacement. |
| `output_structure_invalid` | Reparse, marker identity, or outside-byte preservation failed. |
| `candidate_contract_invalid` | Generated candidate/artifact violates schema. |

## Consequences

- Only output verified to preserve user regions and other blocks becomes reviewable.
- Source, replacement, and output have distinct hash bindings.
- Candidate generation is deterministic and write-free.
- Legacy or ambiguous Markdown is never silently rewritten.
- A later applier must revalidate artifact/output and require explicit approval.
