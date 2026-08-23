# ADR-0146: Hub-Owned Remote Command Authoring and Artifact Delivery

- Status: accepted
- Decision date: 2026-08-22

> [ADR-0147](0147-bounded-command-artifact-lifecycle.md) adds bounded automatic cleanup and orphan recovery for command CAS.

## Context

Authenticated delivery existed, but fixtures authored commands directly and supplied fixed payload bytes. Allowing each client to choose issue time, nonce, and signature would fragment security and idempotency. Raw requests must not spread through queues or events, and project scope alone must not allow another Node to read leased content.

## Decision

`@lervo/hub-command` is platform-neutral. Callers provide destination/project, principal, idempotency key, lifetime, role, provider, risk, suites, and a 1–65,536 byte UTF-8 request. Hub time creates `issuedAt` and `expiresAt`, generates a 32-byte nonce, and uses the configured signer on the canonical command. Authorship stores only `SHA-256(projectIdentityHash + NUL + principalId)`.

`POST /v1/commands/projects/:projectId/submissions` checks bearer `command.write` permission and destination/project scope before reading the body. It returns created or duplicate status, target, delivery ID, first queue time, and signed envelope—never request text, artifact URI, author hash, or submission hash.

The service writes a project-scoped content-addressed artifact, reads it back, then transactionally commits authorship metadata and the queue row. Metadata contains only hashes, size, media type, artifact coordinates, and delivery relation. Identical idempotent submissions return the original envelope and time; changed content, options, or lifetime conflicts without another write. A database failure may leave an unreachable orphan object.

Artifact delivery by `GET` checks `command.delivery`, scope, and `principalId=nodeId`, then transactionally verifies project identity, artifact binding, active lease, owner, and expiry. All absent or unauthorized lease states return `404` without revealing existence.

The Node payload loader requires clean HTTPS URLs except in explicit fixtures, sends bearer authentication, and verifies status, Hub identity, artifact ID, content hash, media type, exact length, strict UTF-8, and bounded bytes. The receiver repeats content validation.

Raw requests never enter commands, SQLite, queue views, events, acknowledgements, receipts, errors, or log payloads. Owner-only CAS enforces `0700` directories and `0600` objects but is not encryption. Authorship is append-only. Expired artifacts become inaccessible but remain physical until lifecycle cleanup; production separates command CAS and applies the default 30-day policy.

Failures use bounded HTTP `400`, `401`, `403`, `409`, `413`, and `500` meanings without secrets or internals. Created and duplicate statuses indicate authoring only—not execution or selected/loaded/injected/used evidence.

## Consequences

Every conversation integration can submit through one neutral port. End-to-end fixtures verify idempotency, conflicts, lease-bound loading, one execution across lost acknowledgement and restart, authorization before body parsing, size limits, identity/hash drift, and owner-only modes. Local managed execution still requires no Hub.
