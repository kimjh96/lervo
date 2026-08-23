# ADR-0106: CLI first-publication package-metadata patch candidate

Status: `accepted`
Decision date: 2026-08-21

## Context

The preview lacked exact output bytes, so manual editing could diverge or apply to stale source. Candidate generation must remain separate from application and must not patch the generated release manifest.

## Decision

Add `release:bootstrap:metadata-candidate` with the same decision inputs and mutually exclusive `--json` metadata or `--package-json` exact UTF-8 output. Human output explains changes. Machine pnpm invocations use `--silent` to prevent prefix noise.

Rebuild the decision and preview from current package and release snapshots. Bind the package source byte count and SHA-256, semantic source digests, and decision and preview digests. Fix candidate status as `review_required` and `writesAllowed=false`, allowing only the four `set` fields.

Require the source to use the current repository JSON format exactly: UTF-8, two-space indentation, and a final LF. Do not normalize other formats. Generate the same format, bind output count and hash, and prove every other JSON value unchanged. If no changes are needed, produce no candidate.

The validator reconstructs candidate metadata and bytes from the source, decision, and preview and requires exact equality. If source changes during generation, produce no output. Metadata may include selected public values and digests, but no old source or path. Full package source appears only in explicit package-json mode.

Provide no writer, generator, approval, online, reservation, or publisher port; mutate, generate, and publish nothing. Failures distinguish argument errors, unsupported format, no changes, and invalid candidates using source-free messages.

## Consequences

Review can bind exact output bytes without granting apply authority. The next step creates a separate hash-bound permit.
