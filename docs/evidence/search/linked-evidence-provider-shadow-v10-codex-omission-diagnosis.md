# V10 Codex omission diagnosis

Status: `complete`
Date: 2026-08-29

## Finding

All six v10 Codex omissions occurred after candidate preparation and context injection. Every omitted reviewed source was in the same exact candidate envelope supplied to both providers. Paired request and candidate-envelope digests matched, and all carrier, adapter, replay, privacy, and primary-effect checks passed. The observed failure stage was provider selection.

Codex repeatedly reduced two independently required sources to the source that appeared newer or more operational:

- For `terse_release`, it selected `docs/distribution/cli-version-management.md` and omitted ADR-0221 in v9 and all four v10 repetitions.
- For `boundary_fuzzy_merge`, it always selected ADR-0227 but omitted ADR-0180 in two of four v10 repetitions.

The omitted documents ranked first in both candidate envelopes, so candidate order does not explain the omissions. The exact one-token outputs were valid, high-precision selections, not adapter or output-framing failures.

## Distinct-claim evidence

Repository instructions independently require both the CLI version-management guide and ADR-0221 for release impact, version preparation, tags, or publication. The guide defines contributor procedure and completion checks. ADR-0221 defines reviewed intent, authority separation, deterministic preparation, rollback, and the tag-handoff decision.

ADR-0227 defines deterministic fuzzy-candidate derivation and approval-gated materialization. ADR-0180 defines the hash-bound human conflict-resolution mechanism that supplies approval authority, and ADR-0227 explicitly references it. Selecting only ADR-0227 leaves the underlying resolution-authority contract unsupported.

These distinctions derive from canonical repository instructions and source bodies, not provider output. V10 output is used only to identify the selection-stage pattern.

## Protocol diagnosis

The v9/v10 minimal-sufficiency protocol retains a document only for a distinct required claim and removes any selection whose removal appears to preserve support. It does not require a coverage inventory before removal. Codex repeatedly collapsed procedure with authority, or derived operation with its approval prerequisite, into one broad claim. Claude did not lose recall, but that does not resolve the provider-neutral ambiguity.

A bounded successor may test one protocol change: before minimization, enumerate independently required claims, authority boundaries, prerequisites, and operational instructions; then remove a source only if another selected body directly states the same item. Candidate generation, order, ground truth, output carrier, safety boundaries, and thresholds must remain unchanged.

## Limits

This diagnosis does not establish internal model reasoning, provider understanding, or production suitability. It does not reclassify any v10 result, retry v10, expose expected paths to either provider, or authorize activation. V11 may measure only the two diagnosed cases and cannot substitute for full-population confirmation.

## References

- [V10 evidence](linked-evidence-provider-shadow-pilot-v10.md)
- [ADR-0264](../../decisions/search/activation/0264-measure-only-unambiguous-provider-shadow-cases-v10.md)
- [CLI version management](../../distribution/cli-version-management.md)
- [ADR-0221](../../decisions/release/packaging/0221-reviewed-cli-release-preparation.md)
- [ADR-0180](../../decisions/knowledge/semantics/0180-hash-bound-human-conflict-resolution.md)
- [ADR-0227](../../decisions/knowledge/semantics/0227-approval-gated-cross-provider-fuzzy-merge.md)
