# ADR-0150: Authenticated, Project-Scoped Hub Sync HTTP

- Status: accepted
- Decision date: 2026-08-22

## Context

Registration, event batches, Node outbox, and Hub persistence existed behind a transport fixture, but lervo-hub exposed no real sync routes. Authentication must precede body processing, and HTTP details must stay outside sync core and storage.

## Decision

@lervo/hub exposes POST registration and event-batches routes under /v1/sync/projects/<projectId>. Each requires exactly one destinationId and projectIdentityHash query. Invalid paths, encoding, methods, or queries fail before storage.

Bearer authentication, sync.write, and destination/project scope are checked before reading the body. Then bounded UTF-8 JSON is read (4 MiB default, 16 MiB maximum), validated, and rebound across URL, body, and derived registration ID. Hub time owns registration and acknowledgement times. Durable @lervo/hub-sync results precede HTTP responses.

AuthenticatedHubHttpTransport fixes clean HTTPS base URL, token, destination/project, and expected Hub identity at construction; plaintext is fixture-only and later mutation of config cannot alter coordinates. Request/response defaults are 4 MiB/1 MiB, both capped at 16 MiB, with a 15-second timeout and no redirects. Status and identity header are checked before body. Only then are content type, length, UTF-8, JSON, and coordinates validated. The header supplements TLS rather than replacing it.

Workers see only AuthenticatedHubTransport; Hub application sees only HubSyncCommandStore; SQLite knows neither HTTP nor credentials.

No new event or sync state is added. Transport failures normalize to hub_unavailable, transport_authentication_failed, invalid_registration_response, or invalid_sync_ack. Hub responses use bounded 400/401/403/409/413/500 errors without internals or secrets. Payload scope remains existing manifest and allowlisted events; no repository bodies, prompts, documents, skills, command output, or credentials are added. HTTP success proves no loaded/injected/used state.

## Consequences

An end-to-end fixture loses a post-commit response, retries the same batch, receives duplicate, and verifies one Hub copy plus local acknowledgement. It also verifies authorization-before-body, identity/binding, HTTPS defaults, immutable construction, bounds/timeouts, runtime persistence, and local operation without Hub.

> Restartable polling is defined by [ADR-0151](0151-restartable-node-outbound-sync-runtime.md).
