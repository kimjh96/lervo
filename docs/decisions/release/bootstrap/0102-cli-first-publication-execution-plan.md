# ADR-0102: CLI first-publication execution plan and unarmed boundary

Status: `accepted`; ADR-0112 creates short-lived arming only from a separate human decision
Decision date: 2026-08-21

## Context

Preflight explains readiness, not authority. Operators need an explicit order and cancellation model without treating a plan as an armed token or bypassing short-lived observations and reservation. Product identity, license, and scope decisions remained unresolved.

## Decision

Execution plan v1 is reconstructed deterministically from the exact bootstrap and publication authorization and fixes:

```json
{"status":"not_armed","activation":"not_implemented","sideEffects":{"reservation":"not_created","publication":"not_attempted","externalSettings":"not_changed"}}
```

Bind source digests, target and artifact hash, preflight nonauthority, confirmations, eight steps, and cancellation boundaries. The reader rebuilds the full plan; redigested edits to status or activation fail validation.

Execution must recheck bootstrap time, interactive readiness, public absence, reservation availability, and the release artifact. The planned order is: inputs; publisher preparation and first confirmation; public absence; durable reservation; artifact; publish; registry verification; terminal storage. The plan executes none of these steps.

Use shared confirmation text. Before reservation, the first confirmation identifies the exact package and version, one interactive 2FA, and no bypass token. After the publish attempt, the second states that the observed 2FA challenge was completed. Neither is npm-signed proof. Refusal after an attempt produces an unknown result and no retry.

Cancellation has three boundaries:

- Before reservation: create no state, but require a new preflight.
- After reservation and before publish: store an abort and require a new bootstrap.
- After publish starts: do not cancel or retry; require reconciliation.

Exclude approver, profile, configuration, credentials, npm output and errors, and preflight source. Add no project or event state.

## Consequences

The plan is static risk documentation, not proof of freshness, reservation, permission, or 2FA.
