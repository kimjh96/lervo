# ADR-0126: npm Stage-Approval Authorization

- Status: accepted
- Decision date: 2026-08-21

## Context

Review evidence is neither a human publication decision nor authority to run npm stage approve, which publishes and requires 2FA.

## Decision

A canonical human decision binds the exact review digest, anonymized stage-ID digest, package/version, and five acknowledgements for at most ten minutes. It acknowledges the public transition, interactive 2FA, prohibition on rejection, and separate result verification. Only actor kind `human_operator` is retained.

`release:bootstrap:stage-approve-authorize` revalidates bounded canonical review and decision sources. Authorization expires at the earliest of ten minutes after review, five minutes after issue, or decision expiry, and grants only `npm_stage_approve_once`. Reject, direct publish, and retry without reconciliation are forbidden.

Both sources are rechecked before exclusively creating a new absolute mode-0600 file. The command performs no network access, npm-client operation, prompt, approval, rejection, or publication check.

## Consequences

Tests cover freshness, binding, forged authority, races, immutable output, and absence of npm side effects.
