# ADR-0102: CLI first-publication execution plan and unarmed boundary

Status: `accepted`; ADR-0112 creates short-lived arming only from a separate human decision
Decision date: 2026-08-21

## Context

Preflight establishes readiness, not authority. Operators need an explicit execution order and cancellation model that neither treats a plan as an armed token nor bypasses short-lived observations and reservation. Product identity, license, and scope remain unresolved.

## Decision

Execution plan v1 is deterministically reconstructed from the exact bootstrap and publication authorization. It fixes this state:

```json
{
  "status": "not_armed",
  "activation": "not_implemented",
  "sideEffects": {
    "reservation": "not_created",
    "publication": "not_attempted",
    "externalSettings": "not_changed"
  }
}
```

The plan binds source digests, target and artifact hash, preflight nonauthority, confirmations, eight steps, and cancellation boundaries. The reader rebuilds the full plan; redigested changes to status or activation fail validation.

Execution must recheck bootstrap time, interactive readiness, public absence, reservation availability, and the release artifact. Its ordered steps are:

1. Inputs.
2. Publisher preparation and first confirmation.
3. Public absence.
4. Durable reservation.
5. Artifact.
6. Publish.
7. Registry verification.
8. Terminal storage.

The plan executes none of them.

Use shared confirmation text. Before reservation, the first confirmation identifies the exact package and version, one interactive 2FA, and no bypass token. After the publish attempt, the second confirms completion of the observed 2FA challenge. Neither confirmation is npm-signed proof. Refusal after an attempt yields an unknown result and permits no retry.

Cancellation has three boundaries:

- Before reservation: create no state and require a new preflight.
- After reservation but before publish: store an abort and require a new bootstrap.
- After publish starts: do not cancel or retry; require reconciliation.

Exclude approver, profile, configuration, credentials, npm output and errors, and preflight source. Add no project or event state.

## Consequences

The plan is static risk documentation, not evidence of freshness, reservation, permission, or 2FA.
