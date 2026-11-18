# ADR-0070: Write-free search-rollout action preflight

Status: `superseded`  
Decision date: 2026-08-20

Superseded by [ADR-0560](../../foundation/0560-remove-unused-subsystems-to-harden-the-core.md). Lervo no longer ships this capability.

## Context

Action application failed safely but exposed unmet review, policy, operator, head, and input conditions only after invocation. Preflight must explain current eligibility without becoming approval, a reservation, or a guarantee of future success.

## Decision

- `search rollout action check <review-id>` requires an explicit action policy, action, and operator; it never selects the latest inputs.
- Revalidate current selection and quality, then return `eligible` or `ineligible` with bounded reasons.
- Preflight and apply share the same core eligibility logic. For rollback, also perform the read-only engine-policy, head, and fallback-candidate replay checks used immediately before publication. Do not expose a prepared transition object.
- Reasons cover requested-action mismatch; policy or review not yet valid; policy, threshold, or decision mismatch; operator scope; current-head mismatch; and changed quality input.
- Treat missing or tampered sources and replay failures as concrete errors, not `ineligible` results.
- Fix effects to no action selection, acknowledgement, selection change, rollback, or approval. Reserve neither an execution slot nor the CAS head; apply must recheck every condition.
- Return only the requested local operator, policy, review, and selection IDs, decision, and input-change state. Exclude query, quality-source IDs, nonce, source and body data, provider results, credentials, and receipts.

## Consequences

Operators can inspect unmet conditions without side effects. Apply-time revalidation and previous-head CAS remain authoritative.
