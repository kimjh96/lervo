# ADR-0112: One-time CLI first-publication arming authorization

Status: `accepted`; ADR-0113/0114 add unknown-outcome reconciliation and resolution
Decision date: 2026-08-21

## Context

Bootstrap binds evidence/release but is not a human execution decision. Plan is intentionally unarmed and preflight readiness is nonauthoritative. Execution therefore needs a separate short-lived exact-plan decision, while fresh checks/reservation remain execution responsibilities.

## Decision

- Human arming decision v1 has `arm_` ID, `authorize_first_publication_once`, issue/≤5-minute expiry, local user actor, exact package/version and bootstrap/publication/plan digests, plus confirmations of plan review, preflight nonauthority, fresh execution checks, one manual-2FA publish, and reconciliation on unknown.
- Decision cannot predate bootstrap observation or outlive bootstrap. Actor is neither authenticated identity nor npm proof.
- `release:bootstrap:arm` reads absolute authorization/bootstrap/decision and new absolute output, rebuilds plan, validates canonical ≤64-KiB decision, rechecks three input snapshots, and exclusively writes output. It performs no online observation.
- Authorization v1 binds armed/manual-once status, exact registry/package/version/tag/access, all source/decision digests, issue/expiry, durable reservation consumption/five fresh checks, `publisherEntryPoint=not_exposed`, mandatory stage-only transition/direct prohibition, and no side effects. Exclude actor/source/path/credentials/npm bodies/errors.
- Self-contained and source-bound validation reconstructs plan/target/time and rejects redigested broad/repeat/publisher-entry authority.
- Execution validates authorization at start, after public observation, and at reservation. Expiry during observation prevents reservation/publish.
- Reservation v2 retains bootstrap-derived ID but adds arming digest, so rearming cannot bypass an existing reservation. Execution/transition receipts retain the same binding.
- Reject legacy reservation/receipt v1; no automatic conversion.

Failures distinguish arguments/source/decision/authorization/expiry/reservation and reuse bounded source errors without sensitive echoes.

## Consequences

Only a short-lived human decision over the exact plan can arm the execution core; arming itself does not reserve, prompt, observe, publish, or configure anything, and no publisher CLI/job is exposed.
