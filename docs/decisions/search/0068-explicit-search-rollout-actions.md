# ADR-0068: Explicit search-rollout actions and atomic rollback

Status: `accepted`
Decision date: 2026-08-20

## Context

A policy-compliant review is judgment, not execution authority. Automatically applying it mixes reviewer/operator responsibility and may execute after head or observations change. Writing rollback transition and separate receipt could partially complete.

## Decision

- Separate `SearchRolloutActionPolicy` v1 from review policy. Bind exactly one review policy, one action (`acknowledge_keep` or `execute_rollback`), allowed operators, and time.
- Rollback policy also binds one engine activation policy and cannot widen its operators; keep policy has none.
- Store at most 32 immutable mode-`0600`, 64-KiB policies under `search-rollout-action-policies`.
- Require explicit review ID/action/policy/operator; never select latest. Revalidate v2 policy binding/thresholds, matching human decision, current head, unchanged attempt/assessment input digest, operator scope, and rollback engine policy.
- Keep writes one immutable `SearchRolloutKeepAcknowledgement` (max 256) claiming only `acknowledgement_recorded`.
- Rollback writes no separate receipt. Engine activation schema v3 content-binds action/review/engine policies, rollout review, current quality snapshot/digest in the same previous-head CAS transition.
- Consumers fully reconstruct v3 evidence, including review- and rollback-time observations; any mismatch makes operational selection unavailable, never silent baseline.

Sources contain only project/policy/review/selection/snapshot IDs, digest, local operator, and time. Exclude query/source/result/credential/receipt and add no event/Hub sync. Any eligibility/contract/IO failure mutates nothing.

## Consequences

Keep acknowledgement and rollback are explicit operator actions; rollout-grounded rollback is atomic with its immutable selection transition.
