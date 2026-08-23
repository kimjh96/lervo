# ADR-0055: Reviewed search evaluation cases and repeat measurement

Status: `accepted`
Decision date: 2026-08-20

## Context

One attempt/assessment cannot reveal regression after engine changes. Storing historical queries in telemetry or converting empty results/run success into truth would break privacy and evaluation validity. Repeatable evaluation needs user-reviewed query and expected sources with a different lifecycle from execution telemetry.

## Decision

- Create `SearchEvaluationCase` only from a valid attempt and its assessment. Query digest/length/term count must match. Expected sources must be assessor-declared expected sources or accepted selected sources; a failed assessment without expected sources cannot promote.
- Bind `any`/`all`, allowed rank 1–50 within original limit, evaluator/verdict/reason, baseline index/result set, and baseline expected-source ranks. Recompute baseline status; do not equate subjective failure reason with deterministic rank criteria.
- Store one immutable case at `.lervo/search-evaluations/<caseId>.yaml`, maximum 256, 64 KiB, mode `0600`. Reject symlinks, unknown files, unstable reads, and ID mismatch. Never overwrite or append history.
- Only case YAML stores reviewed query source. Users must remove secrets and choose repository exposure. Attempts/results/runs/events/Hub never copy it.
- `lervo search evaluate` validates all cases and corpus first, builds `lexical-v1` once, runs each query to 50 results, and records expected-source ranks.
- A case passes when expectation/rank holds; otherwise fail `no_results`, `expected_source_missing`, or `low_rank`. Recompute path-free result-set hash and classify versus baseline as `improved`, `unchanged`, or `regressed`, without claiming semantic sufficiency/use.
- Store content-bound per-case results first, then a validated run last. Orphan results without a run are not completed evaluation.

Failures distinguish invalid cases/results/runs, unsafe case layout/read/write, 256-case overflow, no cases, and observation publication failure. On any case-source error execute none; never publish a partial run.

Add no event. Cases/results/runs are not Hub sync, execution evidence, verification, shared context, or E1–E4. Regression counts do not choose embeddings; keep `embeddingDecision=not_determined`.

## Consequences

Reviewed search behavior becomes repeatable without duplicating queries into operational observations.
