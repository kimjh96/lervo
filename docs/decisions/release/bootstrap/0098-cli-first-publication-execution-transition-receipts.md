# ADR-0098: CLI first-publication execution and transition receipts

Status: `accepted`; ADR-0112 adds arming, ADR-0113 reconciliation, ADR-0115 evidence union
Decision date: 2026-08-21

## Context

Bootstrap does not prove a one-time attempt, safe handling of lost npm response, or later stage-only restriction. External publish cannot be atomic with local storage, so boolean success hides duplicate risk. Package creation and steady-state publisher transition are separate facts.

## Decision

Separate durable reservation, execution receipt, and external orchestration:

1. Revalidate bootstrap and exact publication authorization.
2. Reobserve public package absence.
3. Reserve deterministic ID from bootstrap digest durably.
4. Revalidate tar bytes, then call publisher once.
5. Accept exact registry/digests only as `published_transition_pending` receipt.
6. Return success only after store commits exact receipt digest as `published`.

Pre-call tar change records `aborted_before_publication/new_bootstrap_required`. Any post-call error or unconfirmed receipt/completion records `publication_unknown/retry=forbidden`; reservation alone forbids automatic retry even if unknown-state write fails.

Transition completion independently requires verified workflow shape/permissions/stage command, exact npm stage-only trust, and protected GitHub environment. Recompute all sources rather than trusting a supplied readiness report. A canonical completed receipt records bootstrap consumed, mode `trusted_publisher_stage_only`, and direct publish forbidden; readers reproduce it from source.

Store reservation/receipts as per-execution documents, not append history. Exclude approvers, trust/reviewer identities, credentials, 2FA/OIDC, and external response bodies. Add no project/runtime event.

## Consequences

Core and synthetic fixtures distinguish pre-call abort from unknown post-call outcome and reject broad publisher transitions. Durable adapters/interactive execution/real npm and settings were not yet activated here.
