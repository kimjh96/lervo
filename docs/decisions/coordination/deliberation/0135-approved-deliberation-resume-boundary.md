# ADR-0135: Resume Only from an Approved Deliberation Boundary

- Status: accepted
- Decision date: 2026-08-21

## Context

Restarting approved review wastes work, but serializing arbitrary intermediate state can legitimize partially persisted history.

## Decision

Lervo checkpoints only after every reviewer approves the latest claim and before verification. The immutable owner-only file .lervo/state/deliberations/<id>/checkpoints/approved.json records topic, mode, policy hash, runtime coordinates, artifact/publication/handoff events, provider-role sessions, workspace documents, and current claim.

lervo deliberate --resume <id> revalidates current policy hash, start/artifact events, publication/handoffs, absence of completion, CAS hashes and sizes, generated-document paths/hashes/writing contract, and ordered provider-role separation. Any mismatch or later deliberation artifact blocks resume. Only verification and decision run in new sessions. Completed deliberations cannot resume.

An exclusive process lease spans checkpoint through termination. Live leases block; only dead-owner leases may be atomically taken over under ADR-0137. Checkpoints are local recovery sources, not selected/loaded/injected/used evidence, and are bounded to 1 MiB regular no-follow files.

## Consequences

Pre-approval interruptions require a new deliberation. Resume preserves the deliberation ID and append-only event chain only when all policy, event, CAS, document, and role sources still match.
