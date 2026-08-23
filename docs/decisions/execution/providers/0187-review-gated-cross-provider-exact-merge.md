# ADR-0187: Review-Gated Cross-Provider Exact Merge

- Status: accepted
- Decision date: 2026-08-23

## Context

Comparing stored candidates does not prove two live compiler calls. Exact claims may also appear with different titles or summaries. Exact overlap must not automatically become publication, consensus, or truth.

## Decision

`knowledge stability` with baseline and candidate artifacts compares stored outputs from the same provider and build and reports `observationBasis=candidate_artifacts_only`. With `--provider`, it observes two completed compile calls over the same current scan, policy, and descriptor and reports `two_compile_calls_completed`.

Both modes report only stable or divergent semantic digests. They never assert truth, review, verification, understanding, or use.

`knowledge merge-candidate` revalidates an ADR-0186 comparison and both sources, then creates one immutable, unreviewed candidate. Exact concepts preserve their content with deterministic IDs. When exact claims have different surrounding prose, the merge creates a neutral Lervo concept keyed by the claim digest with a fixed human-review-required summary; neither provider's prose prevails.

Relations are included only when exact concepts and relation signatures match. No relation is inferred between claim wrappers.

Derived provenance is `cross_provider`, `deterministic_local_derivation`, and `lervo.cross-provider.exact-merge@1`, binding the comparison, artifacts, and selected signatures.

Publication still requires normal reconcile, repository-origin human review, and semantic materialization. The decision includes no fuzzy, embedding, or judge merge. A lack of exact overlap is a reconciliation conflict, not grounds for provider preference.

Stability and merge output contains only bounded coordinates and counts; bodies remain owner-only. These operations emit no event. Existing review and materialization events remain privacy-bounded.

## Consequences

Fixtures verify artifact-based and live stability, exact concept merging, neutral exact-claim wrappers, stale-comparison rejection, canonical storage, and the compare-to-review-to-materialize-to-lint flow.

Real pilots observed variable provider stability and partial exact-claim overlap. These observations are neither provider rankings nor long-term claims.
