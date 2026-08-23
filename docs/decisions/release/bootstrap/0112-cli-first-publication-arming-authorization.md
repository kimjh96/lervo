# ADR-0112: One-time CLI first-publication arming authorization

Status: `accepted`; ADR-0113/0114 add unknown-outcome reconciliation and resolution
Decision date: 2026-08-21

## Context

Bootstrap binds evidence and release state but is not a human execution decision. The plan is intentionally unarmed, and preflight readiness is nonauthoritative. Execution therefore requires a separate, short-lived decision over the exact plan; fresh checks and reservation remain execution responsibilities.

## Decision

- Human arming decision v1 has an `arm_` ID, action `authorize_first_publication_once`, issue time, expiry within five minutes, local user actor, exact package/version, and bootstrap/publication/plan digests. It confirms plan review, preflight nonauthority, fresh execution checks, one manual-2FA publish, and reconciliation after an unknown outcome.
- The decision cannot predate the bootstrap observation or outlive the bootstrap. Its actor is neither authenticated identity nor npm proof.
- `release:bootstrap:arm` reads absolute authorization, bootstrap, and decision paths plus a new absolute output path; rebuilds the plan; validates the canonical decision of at most 64 KiB; rechecks the three input snapshots; and exclusively writes the output. It performs no online observation.
- Authorization v1 binds armed/manual-once status, exact registry/package/version/tag/access, all source and decision digests, issue and expiry times, durable reservation consumption, five fresh checks, `publisherEntryPoint=not_exposed`, mandatory stage-only transition, direct-publish prohibition, and no side effects. Exclude actors, sources, paths, credentials, npm bodies, and errors.
- Self-contained, source-bound validation reconstructs plan, target, and time, and rejects redigested broad, repeat, or publisher-entry authority.
- Execution validates authorization at startup, after public observation, and at reservation. Expiry during observation prevents reservation and publication.
- Reservation v2 retains the bootstrap-derived ID and adds the arming digest, preventing rearming from bypassing an existing reservation. Execution and transition receipts retain that binding.
- Reject legacy reservation and receipt v1; do not convert them automatically.

Failures distinguish arguments, source, decision, authorization, expiry, reservation, and bounded source errors without exposing sensitive values.

## Consequences

Only a short-lived human decision over the exact plan can arm the execution core. Arming does not reserve, prompt, observe, publish, configure, or expose a publisher CLI/job.
