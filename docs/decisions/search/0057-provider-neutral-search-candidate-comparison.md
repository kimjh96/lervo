# ADR-0057: Provider-neutral search candidate comparison

Status: `accepted`
Decision date: 2026-08-20

## Context

Running candidates inside operational search would mix experiments with production. Engine scores are incomparable, and baseline-only output after candidate failure must not look like a completed comparison. The comparison contract must precede candidate implementations.

## Decision

- `SearchEvaluationEnginePort` exposes engine ID/version and `buildIndex`. Its index has matching identity/content-derived ID and bounded search.
- Common runner accepts sync/async adapters and revalidates engine/index, query digest/size, result hash, and top-50 contract.
- Generalize evaluation result/run engine coordinates, but keep operational attempts and managed-context recommendations fixed to `lexical-v1`.
- Require bundle `comparisonReadiness=ready` before reading corpus or invoking candidate.
- Feed baseline and candidate the exact same registered-Markdown `SearchSourceInput`, active cases, evaluation time, and top-50 criteria. Recompute corpus digest and baseline index/run from real source.
- Port delivery proves only equal inputs, not candidate internal use.
- Per case, compare pass/fail only: `baseline_win`, `candidate_win`, or `tie`. Do not compare scores, rank when both pass, or failure reasons when both fail.
- Aggregate as `baseline_better_observed`, `candidate_better_observed`, `mixed`, or `no_difference_observed`; retain both candidate and embedding decisions `not_determined`.
- Publish both engines' immutable results/runs first, then the fully revalidated `SearchEvaluationComparison` last. Without comparison, orphan results/runs are not completed comparison.
- Comparison contains only bundle/coverage/corpus/time, engines/indexes/runs, case result IDs, and observations—never query, body/path, prompt, response, or credential.

Failures distinguish invalid engine, not-ready coverage, inconsistent comparison, candidate build/search failure, and observation write failure. Candidate failure publishes neither new baseline nor candidate comparison sources.

Add no event/Hub sync. Comparison is not verification, context evidence, knowledge, or engine adoption. Actual candidate adapters/registry/CLI activation remain outside this ADR.

## Consequences

Candidates can be compared under equal, review-bound inputs without changing operational search or pretending score scales are equivalent.
