# ADR-0005: Shared Context and Role Handoff

- Status: `accepted`
- Decision date: 2026-08-18

## Context

Lervo coordinates specialist roles within one project. The role contract named required documents and allowed handoffs but did not define the immutable source and evidence read by a receiving role.

Conversation summaries or a producing role's read receipt would provide false evidence. Injecting every source into every model turn would waste tokens and unnecessarily expose restricted material.

## Decision

### Shared source

Cross-role material is published as a registered document pinned by content hash.

`SharedContextPublication` records its ID, project, document ID, hash and revision, context kind, producer, evidence events, audience, sensitivity, publication and expiry times, and replacement relation.

Agent-produced context records the role, run, and session and links at least one evidence event. `audience.mode=project` makes context discoverable by every project role. Restricted context must use `audience.mode=roles` with an allowlist and cannot be project-wide.

Publication creates a discovery path; it does not promote content to verified knowledge.

### Handoff

A role declares when a handoff requires evidence links and shared context.

`HandoffBundle` records handoff and project IDs, the sending role/run/session/context generation, receiving role, request digest, shared-context IDs, evidence-event IDs, and creation time. The sender must permit the recipient. Every referenced publication must belong to the same project and be readable by the recipient.

A bundle never contains raw requests, document bodies, or internal reasoning.

Because v0 had not published role manifests into user repositories, these fields strengthen role schema version 1 before M2. Equivalent changes after external publication require a new schema version and migration.

### Evidence at the receiving role

Publication or handoff creation does not prove that the recipient read the material.

The receiving role must:

1. Select each document with `reasonCode=handoff`, producing E1.
2. Re-read the current bytes and verify the hash in its own run and session, producing E2.
3. Record a separate receipt for delivery into the receiving provider session, producing E3.

The producer's E2 or E3 cannot open the recipient's write gate. Expiry, a changed source hash, context compaction or restart, and publication replacement invalidate earlier receipts.

### Events and failures

| Event | Required metadata | Meaning |
| --- | --- | --- |
| `context.published` | Shared-context/document IDs, content hash, producer role, audience and allowed roles, expiry | Context became discoverable; recipient reading or injection is not proven. |
| `handoff.created` | Handoff ID, sender and recipient roles, shared-context/evidence-event IDs, request digest | An evidence-linked handoff was created; completion or receipt is not proven. |

Events store only IDs and digests. Source bodies remain in registered documents or CAS. Event-write failure stops the run with `telemetry_recording_failed`; no sharing or handoff is claimed.

Invalid producers or recipients, missing or cross-project context, and inaccessible context produce `contract_validation_failed`. Context that is unpublished, expired, or replaced produces `required_context_missing`. Contract failure takes precedence when both apply.

## Consequences

- Roles discover and read authorized project context from the same hash-bound source.
- Collaboration does not depend on hidden model memory or arbitrary conversation summaries.
- Discoverability remains distinct from evidence of selection, loading, and injection.
- The M2 context router can process repository instructions, shared context, and handoffs through one document-reading path.
