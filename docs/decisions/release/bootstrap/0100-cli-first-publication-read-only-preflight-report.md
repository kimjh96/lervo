# ADR-0100: Read-only CLI first-publication preflight report

Status: `accepted`
Decision date: 2026-08-21

## Context

Durable and interactive components lacked one safe explanation of blockers. Calling execution for diagnostics could reserve or publish, while separate checks could disagree. Preflight results cannot provide reusable authorization because observations expire and another process may reserve.

## Decision

The read-only inspector accepts the exact bootstrap, publication authorization, and release directory, then reports five ordered checks:

- `bootstrap_freshness`
- `release_artifact`, with bounded digest recalculation
- `public_package_absence`, classified as not-found, existing, or unavailable
- `reservation_state`, classified as missing, reserved, terminal, or unavailable
- `npm_interactive_readiness`, covering TTY, non-CI, no environment credential, npm, and profile

Each check is ready, blocked, or unknown. Unknown blocks the overall result. V1 binds source digests, time, and checks; sets `advisoryOnly: true`; and fixes these no-effects: reservation not created, publication not attempted, and external settings unchanged.

The reader recalculates the report from bootstrap, authorization, and observations rather than trusting only the report hash. Store `observe` creates no root or reservation for missing state and returns only bounded coordinates for existing state. Partial, symlinked, inaccessible, corrupt, or mismatched state is unavailable, not missing.

Execution and reporting share one pure npm-readiness policy. Observations and reports exclude profile, user, configuration, environment names and values, token, OTP, and npm output. They retain only controlled reasons. Ready describes current diagnostics; it does not establish npm authority, 2FA, absence of bypasses, or future success.

## Consequences

The inspector has no reservation, publisher, prompt, or settings-write port. Execution must independently reobserve, reserve, and confirm. Fixtures verify fail-closed combinations, source minimization, semantic-redigest rejection, artifact mutation, corrupt stores, and absence of directory creation.
