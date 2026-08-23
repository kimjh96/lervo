# ADR-0107: CLI first-publication package-metadata apply permit

Status: `accepted`
Decision date: 2026-08-21

## Context

Candidate binds source/output but explicitly disallows writes. Applying merely because it exists does not prove the exact candidate was reviewed. Permit creation must stay separate from filesystem effects and become stale on source change.

## Decision

Add `release:bootstrap:metadata-permit` with the metadata decision, reviewed candidate/source/output SHA-256 values, explicit `--confirm-reviewed-candidate`, and JSON output. The operator must first review candidate metadata and exact package JSON.

Rebuild decision/preview/candidate/output from current package/release snapshots and run full candidate validation. Issue permit v1 only when all three submitted digests match.

Permit binds applied status/type, package/version/path and selected public metadata, candidate/source/output counts/hashes, human-operator exact-apply decision/confirmation, package compare-and-swap, generated release-manifest regeneration with direct patch forbidden, authority `local_package_metadata_only`, and no side effects in this command.

The confirmation is a human statement, not independently authenticated review. Compare-and-swap is not durable single-use protection and cannot detect source reverted to old bytes; applier must recheck current hash.

Output stdout only; human English hides digests/paths/old values, JSON is canonical. Provide no writer/generator/online/reservation/publisher. Failures distinguish arguments/review/permit and reuse upstream source/candidate errors without echoing inputs.

## Consequences

Exact reviewed bytes gain conditional minimal write authority, while actual transaction/rollback remains separate.
