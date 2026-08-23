# ADR-0059: Search candidate review with replay verification

Status: `accepted`
Decision date: 2026-08-20

## Context

A favorable comparison does not justify production activation: bundle/corpus may have changed and the same engine name may now implement different behavior. Observation and human adoption/rejection must remain separate sources.

## Decision

- Safely load one requested comparison by fixed ID and verify its content ID plus current cases, bundle, coverage, corpus, both runs, every result, evaluation time, engine/index coordinates, and aggregate.
- Resolve the recorded candidate only from the static registry, never path/package/URL/import.
- Replay the current candidate once using the original corpus, active cases, and time. Mark `matched` only when the common contract passes and new run ID exactly equals recorded candidate run.
- Reviewer explicitly chooses `adopt_candidate`, `reject_candidate`, or `more_samples_required`; observed aggregate never chooses automatically.
- Minimum adoption gate requires at least one candidate win and zero baseline wins. Passing it yields `eligible_for_activation_review`; rejection yields `rejected`; more samples yields `more_evidence_required`. None activates production.
- `SearchCandidateReview` content-binds comparison/bundle/coverage/corpus, candidate/engine, old/replay run IDs, reviewer/time/decision, case totals, and verification states.
- Publish one mode-`0600` immutable `.lervo/state/search/evaluation-reviews/<reviewId>.json`; multiple reviews remain separate. Current controlling review is outside this stage. Fix `activationState=not_applied` and embedding decision undetermined.

Reviewer ID stays project-local. Do not copy queries, paths/bodies, prompts, results, or credentials. Replay creates no new source store/event/Hub sync and proves neither context nor verification nor activation.

Failures distinguish missing/invalid comparison, unregistered/failed candidate, invalid/ineligible review, and immutable publication conflict/failure. Pre-publication failure leaves existing evidence unchanged and no review file.

## Consequences

Human review is tied to a complete, reproducible comparison while remaining distinct from operational activation.
