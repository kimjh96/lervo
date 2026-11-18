# ADR-0057: Provider-neutral search candidate comparison

Status: `superseded`
Decision date: 2026-08-20

Superseded by [ADR-0560](../foundation/0560-remove-unused-subsystems-to-harden-the-core.md). Lervo no longer ships this capability.

## Context

Running candidates in operational search would mix experiments with production. Engine scores are not comparable, and baseline-only output after candidate failure must not appear to be a completed comparison. The comparison contract must precede candidate implementations.

## Decision

- `SearchEvaluationEnginePort` exposes engine ID, version, and `buildIndex`. Its index has matching identity, a content-derived ID, and bounded search.
- The common runner accepts synchronous or asynchronous adapters and revalidates engine/index identity, query digest and size, result hash, and the top-50 contract.
- Generalize evaluation result and run engine coordinates, while keeping operational attempts and managed-context recommendations fixed to `lexical-v1`.
- Require bundle `comparisonReadiness=ready` before reading the corpus or invoking a candidate.
- Give baseline and candidate the identical registered-Markdown `SearchSourceInput`, active cases, evaluation time, and top-50 criteria. Recompute the corpus digest and baseline index/run from the actual source.
- Port delivery proves only equal inputs, not the candidate's internal use of them.
- Compare only per-case pass/fail: `baseline_win`, `candidate_win`, or `tie`. Do not compare scores, ranks when both pass, or failure reasons when both fail.
- Aggregate as `baseline_better_observed`, `candidate_better_observed`, `mixed`, or `no_difference_observed`. Keep both candidate and embedding decisions `not_determined`.
- Publish both engines' immutable results and runs first, then the fully revalidated `SearchEvaluationComparison`. Without the comparison, orphan results and runs do not constitute a completed comparison.
- A comparison contains only bundle, coverage, corpus, time, engines, indexes, runs, case result IDs, and observations—never queries, bodies, paths, prompts, responses, or credentials.

Distinguish invalid engines, not-ready coverage, inconsistent comparisons, candidate build or search failures, and observation-write failures. Candidate failure publishes no new baseline or candidate comparison sources.

Add no event or Hub sync. A comparison is not verification, context evidence, knowledge, or engine adoption. Candidate adapters, registry, and CLI activation remain outside this ADR.

## Consequences

Candidates can be compared using equal, review-bound inputs without changing operational search or treating score scales as comparable.
