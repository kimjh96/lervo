# ADR-0064: Selection-bound operational search quality observations

Status: `accepted`
Decision date: 2026-08-20

## Context

Global attempt/assessment reports mixed observations from candidate selection and rollback baseline. Copying build/receipt into immutable attempts would duplicate selection evidence and change legacy hashes.

## Decision

- Add derived `SearchSelectionQualityReport` v2 with existing totals plus slices by nullable `selectionTransitionId`.
- Classify no-transition lexical as `implicit_baseline`, candidate activation/refresh as `candidate`, and baseline rollback as `recorded_baseline`.
- Revalidate all attempts/assessments and complete selection chain with policies/reviews/comparisons.
- Derive candidate build ID from review (`bound` for v2, `legacy_unbound` for v1); baseline is `not_applicable`. Write nothing back and omit empty transitions.
- Count only explicit assessments. Unassessed remains unassessed; hits/clicks/recommendations/context/runs/verification never synthesize one.
- `no_failures_observed` describes only assessed items, not sufficiency or rollout success. Keep rollout, rollback, and embedding decisions undetermined and perform no mutations/actions.
- Slices expose transition/public engine/build/counts only—not query/digest/nonce/index/result/source/path/body/prompt/response/credential/receipt.
- Any missing transition, engine mismatch, or invalid evidence fails the whole report; never omit a bad slice.

## Consequences

Operational quality is attributable to exact selection/build evidence without altering immutable attempts or automating rollout decisions.
