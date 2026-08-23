# ADR-0062: Refreshing evidence for a selected search candidate

Status: `accepted`
Decision date: 2026-08-20

## Context

A selected candidate is bound to comparison-time corpus and correctly becomes unavailable when documents change. Continuing the same candidate after fresh validation needs a distinct transition; reusing activation would hide evidence refresh, and rollback to stale candidate evidence would be unsafe.

## Decision

- Add schema-v2 `refresh_candidate`, allowed only when current and next candidate/engine coordinates are identical.
- Require new comparison/review against current bundle/cases/corpus/registered engine/replay and reapply reviewer/operator/candidate/win policy.
- Reject repeated evidence or a different candidate; use `activate_candidate` for changes.
- Append an immutable `<previousActivationId>.json`, binding old selection and new evidence. `selection_recorded` still proves no query/use.
- Set refresh fallback to `lexical-v1` with no fallback activation. Rollback after refresh returns baseline rather than replaying stale candidate evidence.
- Share fallback resolution between pure transition creation and rollback runner. Refresh failure changes neither files nor selection and never auto-falls back.

Store only project/public engine/candidate and review/comparison/policy/operator/time coordinates in mode-`0600` local state. Add no event/Hub source or query/body/prompt/result/credential fields.

Failures use activation-not-found, not-eligible, invalid transition, and head conflict semantics.

## Consequences

The same candidate can regain availability through explicit fresh evidence, with safe baseline rollback and an unchanged evaluation baseline.
