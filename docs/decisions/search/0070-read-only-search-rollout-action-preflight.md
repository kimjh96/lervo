# ADR-0070: Write-free search-rollout action preflight

Status: `accepted`
Decision date: 2026-08-20

## Context

Action apply failed safely but revealed unmet review/policy/operator/head/input conditions only afterward. Preflight must explain current eligibility without becoming approval, reservation, or future-success guarantee.

## Decision

- `search rollout action check <review-id>` requires explicit action policy, action, and operator; never selects latest inputs.
- Revalidate current selection and quality and return `eligible` or `ineligible` with bounded reasons.
- Preflight and apply share the same core eligibility. For rollback, also run read-only engine-policy/head/fallback-candidate replay checks used immediately before publication. Do not expose a prepared transition object.
- Reasons cover requested-action mismatch, not-yet-valid policy/review, policy/threshold/decision mismatch, operator scope, current-head mismatch, and changed quality input.
- Missing/tampered source or replay failure remains a concrete error, not softened to ineligible.
- Fix effects to no action selection, acknowledgement, selection change, rollback, or approval. Reserve neither execution slot nor CAS head; apply rechecks everything.
- Return only requested local operator, policy/review/selection IDs, decision, and input-change state—not query, quality-source IDs, nonce, source/body, provider result, credential, or receipt.

## Consequences

Operators can inspect unmet conditions without side effects; apply-time revalidation and previous-head CAS remain authoritative.
