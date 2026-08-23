# ADR-0135: Resume Only from an Approved Deliberation Boundary

- Status: accepted
- Decision date: 2026-08-21

## Context

Restarting an approved review wastes work, but serializing arbitrary intermediate state can legitimize partially persisted history.

## Decision

Lervo checkpoints only after every reviewer approves the latest claim and before verification. The immutable, owner-only `.lervo/state/deliberations/<id>/checkpoints/approved.json` records the topic, mode, policy hash, runtime coordinates, artifact/publication/handoff events, provider-role sessions, workspace documents, and current claim.

`lervo deliberate --resume <id>` revalidates:

- the current policy hash;
- start and artifact events;
- publications and handoffs;
- absence of completion;
- CAS hashes and sizes;
- generated-document paths, hashes, and writing contract; and
- ordered provider-role separation.

Any mismatch or later deliberation artifact blocks resume. Only verification and decision run in new sessions. Completed deliberations cannot resume.

An exclusive process lease spans checkpoint creation through termination. A live lease blocks resume. Only a dead owner's lease may be atomically taken over under ADR-0137.

Checkpoints are local recovery sources, not selected, loaded, injected, or used evidence. Each checkpoint must be a regular, no-follow file no larger than 1 MiB.

## Consequences

Interruptions before approval require a new deliberation. Resume preserves the deliberation ID and append-only event chain only while all policy, event, CAS, document, and role sources still match.
