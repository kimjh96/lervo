# ADR-0059: Search candidate review with replay verification

Status: `accepted`
Decision date: 2026-08-20

## Context

A favorable comparison does not justify production activation: its bundle or corpus may have changed, and the same engine name may now represent different behavior. Observations and human adoption decisions must remain separate sources.

## Decision

- Safely load one comparison by fixed ID and verify its content ID, current cases, bundle, coverage, corpus, both runs, every result, evaluation time, engine/index coordinates, and aggregate.
- Resolve the recorded candidate only through the static registry, never through a path, package, URL, or import.
- Replay the current candidate once with the original corpus, active cases, and time. Mark `matched` only if the common contract passes and the new run ID exactly matches the recorded candidate run.
- The reviewer explicitly chooses `adopt_candidate`, `reject_candidate`, or `more_samples_required`; the observed aggregate never decides automatically.
- Adoption requires at least one candidate win and zero baseline wins. A passing adoption choice yields `eligible_for_activation_review`; rejection yields `rejected`; requesting more samples yields `more_evidence_required`. None activates production.
- `SearchCandidateReview` content-binds comparison, bundle, coverage, corpus, candidate/engine, old and replay run IDs, reviewer, time, decision, case totals, and verification states.
- Publish one immutable mode-`0600` file at `.lervo/state/search/evaluation-reviews/<reviewId>.json`. Keep multiple reviews separate. Determining the current controlling review is outside this stage. Fix `activationState=not_applied` and leave the embedding decision undetermined.

Reviewer IDs remain project-local. Do not copy queries, paths, bodies, prompts, results, or credentials. Replay creates no new source store, event, or Hub sync and proves neither context, verification, nor activation.

Distinguish missing or invalid comparisons, unregistered or failed candidates, invalid or ineligible reviews, and immutable publication conflicts or failures. A pre-publication failure leaves existing evidence unchanged and creates no review file.

## Consequences

Human review is bound to a complete, reproducible comparison while remaining separate from operational activation.
