# ADR-0106: CLI first-publication package-metadata patch candidate

Status: `accepted`
Decision date: 2026-08-21

## Context

Preview lacked exact output bytes, so manual editing could diverge or apply to stale source. Candidate generation must remain separate from apply and must not patch generated release manifest.

## Decision

Add `release:bootstrap:metadata-candidate` with the same decision inputs and mutually exclusive `--json` metadata or `--package-json` exact UTF-8 output. Human output explains changes; machine pnpm invocations use `--silent` to avoid prefix noise.

Rebuild decision/preview from current package/release snapshots. Bind package source byte count/SHA-256, semantic source digests, decision/preview digests. Fix candidate `review_required`, `writesAllowed=false`, allowing only four `set` fields.

Require source exactly current repository JSON format: UTF-8, two-space indentation, final LF. Do not normalize other formats. Generate same format, bind output count/hash, and prove all other JSON values unchanged. No changes yields no candidate.

Validator reconstructs candidate metadata and bytes from source/decision/preview and requires exact equality; source changes during generation produce no output. Metadata may include selected public values/digests but no old source/path. Full package source appears only in explicit package-json mode.

Provide no writer/generator/approval/online/reservation/publisher port; mutate/generate/publish nothing. Failures distinguish argument, unsupported format, no changes, and invalid candidate with source-free messages.

## Consequences

Review can bind exact output bytes without granting apply authority; next step creates a separate hash-bound permit.
