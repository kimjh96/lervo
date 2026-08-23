# ADR-0187: Review-Gated Cross-Provider Exact Merge

- Status: accepted
- Decision date: 2026-08-23

## Context

Stored candidate comparison does not prove two live compiler calls, and exact claims may coexist with different titles/summaries. Exact overlap must not become publication, consensus, or truth automatically.

## Decision

knowledge stability with baseline/candidate compares stored same-provider/same-build artifacts and reports observationBasis=candidate_artifacts_only. With --provider it observes two completed compile calls over the same current scan/policy/descriptor and reports two_compile_calls_completed. Both report only stable/divergent semantic digests, never truth, review, verification, understanding, or use.

knowledge merge-candidate revalidates an ADR-0186 comparison and both sources, then creates one immutable unreviewed candidate. Exact concepts preserve content with deterministic IDs. Exact claims with differing surrounding prose get a neutral Lervo concept keyed by claim digest and a fixed human-review-required summary; neither provider's prose wins. Relations appear only when exact concepts and relation signatures match. No relation is inferred between claim wrappers.

Derived provenance is cross_provider, deterministic_local_derivation, lervo.cross-provider.exact-merge@1 and binds comparison, artifacts, and selected signatures. Publication still requires normal reconcile, repository-origin human review, and semantic materialization. No fuzzy/embedding/judge merge is included; no exact overlap is a reconciliation conflict rather than provider preference.

Stability/merge output contains only bounded coordinates/counts; bodies stay owner-only. These steps emit no event. Existing review/materialization events remain privacy-bounded.

## Consequences

Fixtures verify artifact and live stability, exact concept merge, neutral exact-claim wrappers, stale comparison rejection, canonical storage, and compare-to-review-to-materialize-to-lint. Real pilots observed variable provider stability and a partial exact-claim overlap; these results are not provider rankings or long-term claims.
