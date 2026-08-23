# ADR-0098: CLI first-publication execution and transition receipts

Status: `accepted`; ADR-0112 adds arming, ADR-0113 reconciliation, ADR-0115 evidence union  
Decision date: 2026-08-21

## Context

Bootstrap does not prove a one-time attempt, safe handling of a lost npm response, or later stage-only restriction. External publication cannot be atomic with local storage, so a Boolean success value conceals duplicate-publication risk. Package creation and the steady-state publisher transition are separate facts.

## Decision

Separate durable reservation, execution receipt, and external orchestration:

1. Revalidate the bootstrap and exact publication authorization.
2. Reobserve public-package absence.
3. Durably reserve the deterministic ID derived from the bootstrap digest.
4. Revalidate the tar bytes, then call the publisher once.
5. Accept an exact registry and digests only in a `published_transition_pending` receipt.
6. Return success only after the store commits the exact receipt digest as `published`.

A pre-call tar change records `aborted_before_publication/new_bootstrap_required`. Any post-call error or unconfirmed receipt or completion records `publication_unknown/retry=forbidden`. The reservation alone forbids automatic retry, even if writing the unknown-state record fails.

Transition completion independently requires a verified workflow shape, permissions, and stage command; exact npm stage-only trust; and a protected GitHub environment. Recompute every source instead of trusting a supplied readiness report. A canonical completed receipt records bootstrap consumption, mode `trusted_publisher_stage_only`, and prohibition of direct publication; readers reproduce it from source.

Store reservations and receipts as per-execution documents, not append-only history. Exclude approvers, trust and reviewer identities, credentials, 2FA/OIDC data, and external response bodies. Add no project or runtime event.

## Consequences

Core and synthetic fixtures distinguish a pre-call abort from an unknown post-call outcome and reject overly broad publisher transitions. Durable adapters, interactive execution, real npm, and settings were not activated by this decision.
