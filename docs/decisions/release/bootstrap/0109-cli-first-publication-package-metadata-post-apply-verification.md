# ADR-0109: Post-apply verification of CLI first-publication package metadata

Status: `accepted`
Decision date: 2026-08-21

## Context

An apply receipt alone does not prove current files still match or were production-generator outputs. Current metadata alone loses linkage to reviewed candidate/permit. Receipt digest is self-consistency, not signer or execution authenticity.

## Decision

Add read-only `metadata-verify --receipt <absolute> --json`.

- Independently validate v1 receipt fields/order/paths/before-after bindings/effects/digest without claiming issuer or execution.
- Snapshot receipt, package, release manifest, SBOM, lockfile as bounded regular files; require receipt/SBOM exact repository JSON format.
- Require current three output bytes match receipt after-bindings; before-bindings are historical and not compared to current.
- Require no fixed transaction directory both before reads and immediately before report. Any directory, even empty, requires recovery; symlink/non-directory is invalid. Do not inspect/clean journal.
- Reproduce production release manifest using current package override and require exact equality; validate current SBOM against it and same lockfile; recheck all source bytes unchanged after generation.

Report v1 binds verified status, activation unimplemented, target metadata, receipt/plan/permit/candidate and source digests, four local checks plus transaction/output/reproduction/SBOM checks, remaining license approval/name availability/scope control/first-publication approval, receipt authenticity not verified, external state unobserved, and no effects.

All local checks must pass, but report is no permit. Metadata license string differs from legal approval; first-publication approval must later bind current inputs/observations.

Default English separates verified local state from external work. JSON omits bodies/paths/PID/credentials/approval/external responses. Write no report/event/state.

Failures distinguish arguments/source/receipt/pending-or-invalid transaction/output mismatch/release inconsistency/incomplete metadata/report, and expose no source/path/PID/digest.

## Consequences

Current generated sources are linked back to reviewed apply evidence without claiming receipt authenticity or satisfying external authorization.
