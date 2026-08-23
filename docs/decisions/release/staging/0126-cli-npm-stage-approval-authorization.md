# ADR-0126: npm Stage-Approval Authorization

- Status: accepted
- Decision date: 2026-08-21

## Context

Review evidence is neither a human publication decision nor authority to run npm stage approve, which publishes and requires 2FA.

## Decision

A canonical human decision binds exact review digest, anonymized stage-ID digest, package/version, and five acknowledgements for at most ten minutes. It acknowledges public transition, interactive 2FA, rejection prohibition, and separate result verification. Only actor kind human_operator is retained.

release:bootstrap:stage-approve-authorize revalidates bounded canonical review and decision sources. Authorization expires at the earliest of ten minutes after review, five minutes after issue, or decision expiry, and grants only npm_stage_approve_once. Reject, direct publish, and retry without reconciliation are forbidden.

Both sources are rechecked before a new absolute mode-0600 file is exclusively created. The command has no network, npm client, prompt, approval, rejection, or publication check.

## Consequences

Tests cover freshness, binding, forged authority, races, immutable output, and absence of npm side effects.
