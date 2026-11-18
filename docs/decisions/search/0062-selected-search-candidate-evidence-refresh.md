# ADR-0062: Refreshing evidence for a selected search candidate

Status: `superseded`
Decision date: 2026-08-20

Superseded by [ADR-0560](../foundation/0560-remove-unused-subsystems-to-harden-the-core.md). Lervo no longer ships this capability.

## Context

A selected candidate is bound to the comparison-time corpus and correctly becomes unavailable when documents change. Continuing with that candidate after fresh validation requires a distinct transition: reusing activation would conceal evidence refresh, and rollback to stale candidate evidence would be unsafe.

## Decision

- Add schema-v2 `refresh_candidate`, allowed only when current and next candidate/engine coordinates are identical.
- Require a new comparison and review against the current bundle, cases, corpus, registered engine, and replay, and reapply reviewer/operator/candidate/win policy.
- Reject repeated evidence or a different candidate; use `activate_candidate` to change candidates.
- Append an immutable `<previousActivationId>.json` that binds the old selection to new evidence. `selection_recorded` still proves no query or use.
- Set refresh fallback to `lexical-v1` without a fallback activation. Rollback after refresh returns to baseline instead of replaying stale candidate evidence.
- Share fallback resolution between pure transition creation and the rollback runner. Refresh failure changes neither files nor selection and never falls back automatically.

Store only project/public engine/candidate and review/comparison/policy/operator/time coordinates in mode-`0600` local state. Add no event, Hub source, or query/body/prompt/result/credential fields.

Failures use activation-not-found, not-eligible, invalid-transition, and head-conflict semantics.

## Consequences

The same candidate can regain availability through explicit fresh evidence, with safe baseline rollback and an unchanged evaluation baseline.
