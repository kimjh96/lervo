# ADR-0005: Shared context and role handoff

Status: `accepted`
Decision date: 2026-08-18

## Context

Lervo coordinates specialist roles in one project. The role contract identified required documents and allowed handoffs, but did not define which immutable source and evidence a receiving role reads. Copying conversation summaries or reusing the producing role's read receipt would make the evidence false. Injecting every source into every model turn would also waste tokens and expose restricted material unnecessarily.

## Decision

### Shared source

- Publish cross-role material as a registered document pinned by content hash.
- `SharedContextPublication` records its ID, project, document ID/hash/revision, context kind, producer, evidence events, audience, sensitivity, publication and expiry times, and replacement relation.
- Agent-produced context records role, run, and session and links at least one evidence event.
- `audience.mode=project` is discoverable by every project role. Restricted context must use `audience.mode=roles` with an allowlist and cannot be project-wide.
- Publication creates a discovery path; it does not promote content to verified knowledge.

### Handoff

- A role declares that a handoff requires evidence links and shared context.
- `HandoffBundle` records handoff and project IDs, sending role/run/session/context generation, receiving role, request digest, shared-context IDs, evidence-event IDs, and creation time.
- The sender must allow the recipient. Every referenced publication must belong to the same project and be readable by the recipient.
- A bundle never contains raw requests, document bodies, or internal reasoning.
- Because v0 had not yet published role manifests into user repositories, these fields strengthen role schema version 1 before M2. Equivalent changes after external publication require a new schema version and migration.

### Evidence at the receiving role

- Publication or handoff creation does not mean the recipient read the material.
- The receiving role selects each document with `reasonCode=handoff`, producing E1.
- It must re-read current bytes and verify the hash in its own run/session to produce E2.
- Only a separate receipt for delivery into the receiving provider session produces E3.
- The producer's E2/E3 cannot open the recipient's write gate.
- Expiry, source-hash change, context compaction or restart, and publication replacement invalidate previous receipts.

### Events and failures

| Event | Required metadata | Meaning |
| --- | --- | --- |
| `context.published` | Shared-context/document IDs, content hash, producer role, audience and allowed roles, expiry | Context became discoverable. It does not prove recipient reading or injection. |
| `handoff.created` | Handoff ID, sender and recipient roles, shared-context/evidence-event IDs, request digest | An evidence-linked handoff was created. It does not prove completion or receipt. |

Events store IDs and digests only; source bodies remain in registered documents or CAS. Event-write failure stops the run with `telemetry_recording_failed` and no sharing or handoff is claimed. Invalid producers or recipients, missing or cross-project context, and inaccessible context are `contract_validation_failed`. Not-yet-published, expired, or replaced context is `required_context_missing`. Contract failure takes precedence when both apply.

## Consequences

- Roles discover and read authorized project context from the same hash-bound source.
- Collaboration no longer depends on hidden model memory or arbitrary conversation summaries.
- Discoverability remains distinct from selection, loading, and injection evidence.
- The M2 context router can process repository instructions, shared context, and handoffs through one document-reading path.
