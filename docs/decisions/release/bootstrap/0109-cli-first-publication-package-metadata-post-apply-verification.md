# ADR-0109: Post-apply verification of CLI first-publication package metadata

Status: `accepted`
Decision date: 2026-08-21

## Context

An apply receipt does not prove that current files still match or came from production generators. Current metadata alone also loses its connection to the reviewed candidate and permit. A receipt digest proves self-consistency, not signer or execution authenticity.

## Decision

Add the read-only command `metadata-verify --receipt <absolute> --json`.

The verifier must:

- Independently validate v1 receipt fields, ordering, paths, before/after bindings, effects, and digest without asserting issuer or execution authenticity.
- Snapshot the receipt, package, release manifest, SBOM, and lockfile as bounded regular files; require the receipt and SBOM to use the exact repository JSON format.
- Require the current three output byte sequences to match the receipt's after-bindings. Before-bindings are historical and are not compared with current files.
- Require the fixed transaction directory to be absent both before reads and immediately before reporting. Any directory, including an empty one, requires recovery; a symlink or non-directory is invalid. Do not inspect or clean the journal.
- Reproduce the production release manifest using the current package override and require exact equality. Validate the current SBOM against that manifest and the same lockfile, then confirm every source byte remains unchanged after generation.

Report v1 binds verified status, `activation` as unimplemented, target metadata, receipt/plan/permit/candidate and source digests, four local checks, transaction/output/reproduction/SBOM checks, remaining license approval/name availability/scope control/first-publication approval, the fact that receipt authenticity was not verified, unobserved external state, and no effects.

Every local check must pass, but the report is not a permit. A metadata license string is not legal approval, and later first-publication approval must bind the current inputs and observations.

Default English output must separate verified local state from external work. JSON must omit bodies, paths, PIDs, credentials, approvals, and external responses. Write no report, event, or state.

Failures distinguish arguments, source, receipt, pending-or-invalid transaction, output mismatch, release inconsistency, incomplete metadata, and report errors without exposing sources, paths, PIDs, or digests.

## Consequences

Current generated sources remain linked to reviewed apply evidence without claiming receipt authenticity or satisfying external authorization.
