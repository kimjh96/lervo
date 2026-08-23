# ADR-0018: Existing-document adoption and safe migration

Status: `accepted`
Decision date: 2026-08-19

## Context

Lervo must adopt existing repositories containing README, AGENTS, CLAUDE, ADR, MDX, AsciiDoc, custom front matter, and legacy Lervo registries. Starting with a standard managed-block parser could force those sources into Lervo markers or mutate user content. `lervo init` creates only a safe project layout; adoption requires format/ownership analysis and explicit approval.

## Decision

### Implementation order

1. Safe read-only scanner and common `DocumentImportAdapter` contract
2. Per-source, hash-bound `MigrationCandidate` artifacts and dry-run plan
3. Approved metadata-only sidecar apply to sharded layout
4. Per-entry artifacts and structural dry-run for a legacy registry
5. Explicitly approved atomic disable-and-shard apply
6. CommonMark and legacy-marker parsers/adapters
7. Byte-preserving managed-block patch candidates
8. Staleness detector and structural-change candidates

No later stage may modify user documents before earlier contract tests and source-immutability fixtures pass.

### Scanner and adapters

- Core scanning owns roots, exclusions, file/count/byte limits, safe full reads, source hashes, and deterministic order. Reject absolute/escaping paths, symlinks, non-files, and changes during reading. Exclude `.git`, dependency directories, and `.lervo/state` by default.
- `DocumentImportAdapter` exposes identity/version, supported extensions, and detection. It receives only relative path and scanner bytes—no filesystem or event-write port.
- Return format, ownership, proposed document/profile/relations and markers, confidence, and warnings. Markdown, MDX, AsciiDoc, legacy registry, and custom adapters pass one contract suite.

### Hash-bound candidates and plans

Each `MigrationCandidate` records source path/format/hash/bytes, detected ownership, proposed document/profile/relations, confidence/warnings, `observed` or `review_required`, and candidate artifact ID/hash. Store one artifact per source, never append candidates to one document.

`MigrationPlan` binds candidate artifacts, proposed sidecar paths, expected target absence/hash, creation time, and approval coordinates. Dry-run writes nothing. Before apply, recheck every source hash and target layout. Any change makes the whole plan `stale`; ID/path/target conflicts make it `conflict`; never partially apply.

### Metadata-only default

- First approved apply atomically creates only `.lervo/documents/<documentId>.yaml` sidecars. Preserve source location, bytes, front matter, and markers.
- Keep unknown/low-confidence formats `observed/review_required`; do not auto-promote them.
- Body moves, conversion, marker insertion, and splitting require a separate structural patch bound to source/target snapshots, byte preservation outside blocks, and explicit approval.
- Legacy `.lervo/documents.yaml` sharding follows the same rule and is never run implicitly by init.

Approval binds plan ID and every candidate artifact ID/hash exactly once as either `skip` with reason or `approve_sidecar` with a final `DocumentManifest`. Apply must not invent owner, locale, review cycle, or verified revision. Approval time cannot follow apply time, and document/source/target coordinates must match the candidate.

### Atomic sidecar apply

- Recompute plan ID and validate canonical artifact bytes, digest, size, and ID.
- Re-read all source bytes, targets, and current `.lervo/documents/` snapshot; reject any change or conflict with existing IDs, paths, or relations.
- Build and sync sidecars in isolated staging. Create a transaction marker before publication; loaders reject layouts while it exists.
- Publish all sidecars, verify the complete snapshot, durably commit `document.migration.applied`, then remove the marker.
- The event recorder must commit before success and not commit when returning failure. Before event commit, roll back every created file after content-hash verification. After commit, cleanup failure leaves a fail-closed marker and no normal receipt.
- A legacy registry and active shard directory cannot coexist. Metadata-only apply against a legacy layout is `migration_conflict`.

### Legacy registry structural migration

- Read `.lervo/documents.yaml` stably once and split at most 4,096 records in document-ID order.
- Each entry artifact includes source-registry hash, document ID, and the complete original `DocumentRecord`, preserving owner, connected paths, verification, review, and ownership fields.
- Include the source hash in artifact hashes so any byte-level registry change, including comments/serialization, invalidates approvals.
- Preserve exact source bytes at `.lervo/archive/document-registries/sha256/<source-digest>.yaml`. This immutable copy is not an append target. Dry-run only plans `archive_then_remove` and creates no directory.
- Bind plan to new directory/sidecar targets and each referenced document's missing/file/unsafe snapshot. Missing references are review warnings; unsafe snapshots, duplicate/noncanonical paths, or conflicting archive bytes are conflicts. Do not infer managed-block or generated ownership before parser evidence.
- Approval handles every entry artifact exactly once and preserves each approved `DocumentRecord` in its final manifest.
- Stage archive and sidecars, close loaders with `.lervo/.document-migration.lock`, publish the directory atomically, deactivate the legacy file into staging, recheck references/snapshot, commit durable completion, then remove the marker.
- Before event commit, verified rollback restores legacy bytes and removes newly created archive/empty directories. An unverifiable rollback leaves `rollback_failed`; post-commit cleanup failure leaves `migration_finalization_failed`. Failure-injection fixtures cover every transition.

### Event, states, and privacy

`document.migration.applied` contains plan/approval IDs, approval-source digest, before/after layout hashes, created document IDs/content hashes, apply time, and kind-specific artifact hashes. Structural migration adds source-registry and archive-content hashes. Exclude approver identity, all paths, document bodies, manifests, and absolute coordinates. Local receipts may include archive/deactivation/sidecar paths and skipped IDs without claiming those fields were emitted.

| Code | Meaning |
| --- | --- |
| `review_required` | Detection cannot safely decide ownership/profile/relations; preserve source for human review. |
| `plan_stale` | Source or layout changed; write nothing and rescan. |
| `migration_conflict` | ID, path ownership, sidecar, or layout conflicts; no partial apply. |
| `unsupported_format` | No adapter; return an observed candidate and warning rather than excluding source. |
| `unsafe_source` | Path, type, size, or stable reading cannot be guaranteed. |
| `invalid_approval`, `invalid_migration_artifact` | Approval or hash-bound artifact/plan is invalid; reject before writes. |
| `invalid_legacy_registry` | Legacy schema or structural artifacts cannot be built safely. |
| `telemetry_recording_failed` | Completion event failed; roll back sidecars and claim no completion. |
| `migration_finalization_failed`, `rollback_failed` | Marker cleanup or pre-event recovery was unsafe; never report partial success. |

Events contain neither source bodies nor absolute paths.

## Consequences

- Existing formats are discoverable without forcing standard markers.
- Init, import analysis, metadata adoption, and body transformation have distinct authority boundaries.
- A stale dry-run can never mutate newer source.
- Format adapters gain no filesystem authority.
- Managed-block compilers consume parser-verified byte boundaries only.
