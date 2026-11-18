# ADR-0068: Explicit search-rollout actions and atomic rollback

Status: `superseded`  
Decision date: 2026-08-20

Superseded by [ADR-0560](../../foundation/0560-remove-unused-subsystems-to-harden-the-core.md). Lervo no longer ships this capability.

## Context

A policy-compliant review is judgment, not execution authority. Automatic application would mix reviewer and operator responsibilities and could execute after the head or observations change. Separately writing a rollback transition and receipt could leave a partial result.

## Decision

- Define `SearchRolloutActionPolicy` v1 separately from review policy. Bind exactly one review policy, one action (`acknowledge_keep` or `execute_rollback`), allowed operators, and time.
- A rollback policy also binds one engine activation policy and cannot broaden that policy's operators. A keep policy binds no engine activation policy.
- Store at most 32 immutable, mode-`0600`, 64-KiB policies under `search-rollout-action-policies`.
- Require explicit review ID, action, policy, and operator; never select the latest. Revalidate v2 policy binding and thresholds, matching human decision, current head, unchanged attempt and assessment `inputDigest`, operator scope, and rollback engine policy.
- A keep action writes one immutable `SearchRolloutKeepAcknowledgement`, subject to a maximum of 256, and claims only `acknowledgement_recorded`.
- A rollback writes no separate receipt. Engine activation schema v3 content-binds the action, review, and engine policies; rollout review; and current quality snapshot and digest within the same previous-head CAS transition.
- Consumers must reconstruct all v3 evidence, including review-time and rollback-time observations. Any mismatch makes operational selection unavailable; never fall back silently to baseline.
- Sources contain only project, policy, review, selection, and snapshot IDs; digest; local operator; and time. Exclude query, source, result, credential, and receipt data, and add no event or Hub sync.
- Any eligibility, contract, or I/O failure must leave state unchanged.

## Consequences

Keep acknowledgement and rollback require explicit operator actions, and rollout-grounded rollback is atomic with its immutable selection transition.
