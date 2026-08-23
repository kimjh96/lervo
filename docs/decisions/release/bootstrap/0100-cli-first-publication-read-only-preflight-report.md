# ADR-0100: Read-only CLI first-publication preflight report

Status: `accepted`
Decision date: 2026-08-21

## Context

Durable and interactive components existed without one safe explanation of blockers. Calling execution for diagnostics could reserve/publish, while separately implemented checks could disagree. A preflight cannot be reusable authorization because observations expire and another process may reserve.

## Decision

Read-only inspector accepts exact bootstrap, publication authorization, and release directory and reports five ordered checks:

- `bootstrap_freshness`
- `release_artifact` with bounded digest recalculation
- `public_package_absence` as not-found/existing/unavailable
- `reservation_state` as missing/reserved/terminal/unavailable
- `npm_interactive_readiness` for TTY/non-CI/no env credential/npm/profile

Each is ready/blocked/unknown; unknown blocks overall. V1 content-binds source digests/time/checks, `advisoryOnly: true`, and fixed no-effects: reservation not created, publication not attempted, external settings unchanged.

Reader recalculates report from bootstrap/authorization/observations, not only report hash. Store `observe` creates no root/reservation for missing state and returns only bounded coordinates for existing state. Partial/symlink/permission/corrupt/mismatch is unavailable, not missing.

Execution and report share one pure npm-readiness policy. Observations/reports exclude profile/user/config/env names/values/token/OTP/output and retain only controlled reasons. Ready is current diagnostics, not npm authority/2FA/bypass absence/future success.

## Consequences

Inspector has no reservation/publisher/prompt/settings-write port. Execution must reobserve, reserve, and confirm independently. Fixtures verify fail-closed combinations, source minimization, semantic-redigest rejection, artifact mutation, corrupt stores, and no directory creation.
