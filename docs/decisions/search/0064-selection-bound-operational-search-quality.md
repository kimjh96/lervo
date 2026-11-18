# ADR-0064: Selection-bound operational search quality observations

Status: `superseded`  
Decision date: 2026-08-20

Superseded by [ADR-0560](../foundation/0560-remove-unused-subsystems-to-harden-the-core.md). Lervo no longer ships this capability.

## Context

Global attempt and assessment reports mix candidate-selection observations with the rollback baseline. Copying build or receipt data into immutable attempts would duplicate selection evidence and alter legacy hashes.

## Decision

- Add derived `SearchSelectionQualityReport` v2, retaining existing totals and adding slices by nullable `selectionTransitionId`.
- Classify lexical observations without a transition as `implicit_baseline`, candidate activation or refresh as `candidate`, and baseline rollback as `recorded_baseline`.
- Revalidate every attempt and assessment, plus the complete selection chain and its policies, reviews, and comparisons.
- Derive the candidate build ID from its review: `bound` for v2 and `legacy_unbound` for v1. Baseline build state is `not_applicable`. Write nothing back and omit empty transitions.
- Count only explicit assessments. Hits, clicks, recommendations, context, runs, and verification do not turn an unassessed item into an assessment.
- `no_failures_observed` applies only to assessed items; it does not establish sufficiency or rollout success. Rollout, rollback, and embedding decisions remain undetermined, with no mutations or actions.
- Expose only transition, public engine, build, and counts in each slice. Exclude query, digest, nonce, index, result, source, path, body, prompt, response, credential, and receipt data.
- Fail the entire report for a missing transition, engine mismatch, or invalid evidence. Never hide an invalid slice.

## Consequences

Operational quality can be attributed to exact selection and build evidence without changing immutable attempts or automating rollout decisions.
