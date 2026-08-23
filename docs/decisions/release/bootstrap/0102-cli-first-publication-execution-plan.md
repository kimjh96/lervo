# ADR-0102: CLI first-publication execution plan and unarmed boundary

Status: `accepted`; ADR-0112 creates short-lived arming only from a separate human decision
Decision date: 2026-08-21

## Context

Preflight explains readiness, not authority. Operators need an explicit order/cancellation model without treating a plan as an armed token or bypassing short-lived observations/reservation. Product identity/license/scope decisions were still unresolved.

## Decision

Execution plan v1 is deterministically reconstructed from exact bootstrap/publication authorization and fixes:

```json
{"status":"not_armed","activation":"not_implemented","sideEffects":{"reservation":"not_created","publication":"not_attempted","externalSettings":"not_changed"}}
```

Bind source digests, target/artifact hash, preflight nonauthority, confirmations, eight steps, and cancellation boundaries. Reader rebuilds full plan; redigested status/activation edits fail.

Execution must recheck bootstrap time, interactive readiness, public absence, reservation availability, and release artifact. Planned order is: inputs → publisher preparation/first confirmation → public absence → durable reservation → artifact → publish → registry verification → terminal storage. Plan executes none.

Use shared confirmation text. First confirms exact package/version, one interactive 2FA, no bypass token before reservation. Second, after publish attempt, states the observed 2FA challenge was completed. Neither is npm-signed proof; refusal after attempt becomes unknown/no retry.

Cancellation: before reservation has no state but requires new preflight; after reservation/before publish stores abort and requires new bootstrap; after publish start cannot cancel/retry and requires reconciliation.

Exclude approver/profile/config/credential/npm output/errors/preflight source. Add no project/event state.

## Consequences

The plan is static risk documentation, not freshness, reservation, permission, or 2FA proof.
