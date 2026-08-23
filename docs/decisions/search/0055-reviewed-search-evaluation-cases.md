# ADR-0055: Reviewed search evaluation cases and repeat measurement

Status: `accepted`
Decision date: 2026-08-20

## Context

A single assessment cannot reveal regressions after engine changes. Historical queries must not enter telemetry, and empty results or successful runs are not ground truth. Repeatable evaluation requires user-reviewed queries and expected sources with a lifecycle separate from execution telemetry.

## Decision

- Create `SearchEvaluationCase` only from a valid attempt and assessment. Query digest, length, and term count must match. Expected sources must be assessor-declared or accepted selected sources. A failed assessment without expected sources cannot be promoted.
- Bind `any`/`all`, allowed rank 1–50 within the original limit, evaluator, verdict, reason, baseline index/result set, and baseline expected-source ranks. Recompute baseline status; a subjective failure reason is not a deterministic rank criterion.
- Store each immutable case at `.lervo/search-evaluations/<caseId>.yaml`, with limits of 256 cases and 64 KiB and mode `0600`. Reject symlinks, unknown files, unstable reads, and ID mismatches. Never overwrite cases or append history.
- Only case YAML stores the reviewed query source. Users must remove secrets and choose repository exposure. Attempts, results, runs, events, and Hub never copy it.
- `lervo search evaluate` validates every case and the corpus before execution, builds `lexical-v1` once, runs each query for 50 results, and records expected-source ranks.
- A case passes when its expectation and rank hold. Otherwise it fails with `no_results`, `expected_source_missing`, or `low_rank`. Recompute the path-free result-set hash and classify against baseline as `improved`, `unchanged`, or `regressed`, without claiming semantic sufficiency or use.
- Store content-bound per-case results first and a validated run last. Orphan results without a run are not a completed evaluation.

Distinguish invalid cases, results, and runs; unsafe case layout, reads, and writes; 256-case overflow; no cases; and observation-publication failure. If any case source is invalid, execute none and never publish a partial run.

Add no event. Cases, results, and runs are not Hub sync, execution evidence, verification, shared context, or E1–E4. Regression counts do not select embeddings; keep `embeddingDecision=not_determined`.

## Consequences

Reviewed search behavior becomes repeatable without duplicating queries in operational observations.
