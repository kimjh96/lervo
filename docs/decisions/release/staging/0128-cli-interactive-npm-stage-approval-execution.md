# ADR-0128: Interactive npm Stage-Approval Execution

- Status: accepted
- Decision date: 2026-08-21

## Context

Raw stage-ID handling, TTY 2FA, and npm invocation are provider-specific. Failures before preparation and uncertain outcomes after publication starts require different retry semantics.

## Decision

The CLI revalidates review, decision, and authorization and requires explicit online and write boundaries. The provider adapter requires an interactive TTY, non-automation, no ambient credential, explicit user config, isolated cache/global config, npm 11.15+, and exact stage list/view. Raw stage ID exists only inside an adapter closure.

After preparation, the core rechecks sources and authorization, durably stores the attempt, then rechecks stage view and sources once more before invoking exactly one npm stage approve. npm handles OTP through inherited stdin. Streaming child output redacts raw stage IDs and is never stored.

Pre-call failures abort; failures after call start or uncertain source/config/terminal state are unknown. Exit zero is not publication proof and requires registry verification. Every post-call state forbids blind retry.

## Consequences

Tests cover attempt-before-call, one exact approval, TTY/automation gates, races, all outcomes, revalidation, and absence of rejection. Fixtures claim no real approval, 2FA, or publication.
