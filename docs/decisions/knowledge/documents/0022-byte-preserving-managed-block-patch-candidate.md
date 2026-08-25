# ADR-0022: Byte-preserving managed-block patch candidates

Status: `accepted`
Decision date: 2026-08-19

## Context

Parser-verified boundaries do not authorize writes. Reviewers need a source-bound candidate that shows the change and proves preservation of user-owned bytes. Stale output cannot apply after source changes. Metadata holds hashes; complete output bytes remain locally reviewable rather than entering events.

## Decision

`@lervo/documents` exposes filesystem-free `createManagedBlockPatchCandidate`. It accepts a scanner-verified source path, hash, byte count and bytes, a current block ID, and replacement bytes. It:

1. Verifies the source digest and byte count.
2. Requires a fully valid CommonMark parse with exactly one target block.
3. Requires marker family `lervo_v1`; legacy markers remain read-only.
4. Replaces only the content byte range.
5. Re-parses output and proves unchanged block order, IDs, families, and marker bytes.
6. Proves that all bytes before and after the target content are unchanged and that the content equals the replacement.

Replacement must be valid UTF-8 and at most 8 KiB. Empty content is allowed. Reject replacements that break the standalone end marker, inject managed markers, change structure, or equal the current bytes.

Return:

- `ManagedBlockPatchCandidateArtifact`: canonical JSON containing source/parser coordinates, original range and content hash, replacement hash/count, output hash/count/range, and verification constants.
- `outputBytes`: complete review/apply bytes bound by the output hash but excluded from JSON and events.

Derive candidate and artifact IDs from canonical content, not time. Fix `disposition=review_required` and `writesAllowed=false`. Set `onlyTargetContentChanged`, `markerBytesUnchanged`, and `outputStructureValid` to true only after direct proof.

This stage writes no file, CAS object, or event and creates no approval or application state. Metadata contains only hashes and byte coordinates—never source, replacement, or absolute paths.

| Code | Meaning |
| --- | --- |
| `invalid_patch_request` | Invalid block ID or relative path. |
| `source_changed` | Bytes do not match the requested digest/count. |
| `source_structure_invalid`, `block_not_found` | Ownership boundary or target is unverified. |
| `legacy_marker_not_writable` | Explicit migration is required. |
| `replacement_invalid_utf8`, `replacement_too_large`, `no_changes` | Replacement is invalid or ineffective. |
| `output_structure_invalid` | Reparse, marker identity, or outside-byte preservation failed. |
| `candidate_contract_invalid` | Generated candidate or artifact violates its schema. |

## Consequences

- Only output proven to preserve user regions and other blocks becomes reviewable.
- Source, replacement, and output have distinct hash bindings.
- Candidate generation is deterministic and write-free.
- Legacy or ambiguous Markdown is never silently rewritten.
- A later applier must revalidate artifact and output and require explicit approval.
