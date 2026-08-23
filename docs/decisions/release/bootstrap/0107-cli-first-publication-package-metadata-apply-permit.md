# ADR-0107: CLI first-publication package-metadata apply permit

Status: `accepted`
Decision date: 2026-08-21

## Context

A candidate binds source and output but explicitly disallows writes. Its existence does not prove that the exact candidate was reviewed. Permit creation must remain separate from filesystem effects and become stale when the source changes.

## Decision

Add `release:bootstrap:metadata-permit` with the metadata decision, reviewed candidate, source, and output SHA-256 values, explicit `--confirm-reviewed-candidate`, and JSON output. The operator must first review both candidate metadata and the exact package JSON.

Rebuild the decision, preview, candidate, and output from current package and release snapshots, then perform full candidate validation. Issue permit v1 only when all three submitted digests match.

The permit binds applied status and type; package, version, and path; selected public metadata; candidate, source, and output counts and hashes; the human operator's exact-apply decision and confirmation; package compare-and-swap; generated release-manifest regeneration with direct patching forbidden; authority `local_package_metadata_only`; and the absence of side effects in this command.

The confirmation is a human statement, not independently authenticated proof of review. Compare-and-swap is not durable single-use protection and cannot detect a source reverted to old bytes. The applier must recheck the current hash.

Write output only to stdout. Human English output hides digests, paths, and old values; JSON is canonical. Provide no writer, generator, online, reservation, or publisher port. Failures distinguish argument, review, and permit errors and reuse upstream source and candidate errors without echoing inputs.

## Consequences

Exact reviewed bytes gain conditional, minimal write authority while the actual transaction and rollback remain separate.
