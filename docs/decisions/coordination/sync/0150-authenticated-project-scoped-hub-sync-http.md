# ADR-0150: Authenticated, Project-Scoped Hub Sync HTTP

- Status: accepted
- Decision date: 2026-08-22

## Context

Registration, event batches, the Node outbox, and Hub persistence existed behind a transport fixture, but `lervo-hub` exposed no real sync routes. Authentication must precede body processing, while HTTP details remain outside sync core and storage.

## Decision

`@lervo/hub` exposes POST registration and event-batch routes under `/v1/sync/projects/<projectId>`. Every request requires exactly one `destinationId` and `projectIdentityHash` query value. Invalid paths, encoding, methods, or queries fail before storage access.

Bearer authentication, `sync.write`, and destination/project scope are checked before reading the body. The Hub then reads bounded UTF-8 JSON—4 MiB by default and at most 16 MiB—validates it, and binds URL, body, and derived registration ID coordinates. Hub time owns registration and acknowledgement times. Durable `@lervo/hub-sync` results precede HTTP responses.

`AuthenticatedHubHttpTransport` fixes a clean HTTPS base URL, token, destination/project, and expected Hub identity at construction. Plaintext is fixture-only, and later configuration mutation cannot change coordinates. Request and response defaults are 4 MiB and 1 MiB; both are capped at 16 MiB. Requests use a 15-second timeout and no redirects.

The transport checks status and the identity header before reading the body, then validates content type, length, UTF-8, JSON, and coordinates. The identity header supplements TLS rather than replacing it.

Workers see only `AuthenticatedHubTransport`; the Hub application sees only `HubSyncCommandStore`; SQLite knows neither HTTP nor credentials.

Add no event or sync state. Normalize transport failures to `hub_unavailable`, `transport_authentication_failed`, `invalid_registration_response`, or `invalid_sync_ack`. Hub responses use bounded 400, 401, 403, 409, 413, and 500 errors without internals or secrets.

Payload scope remains the existing manifest and allowlisted events. Add no repository bodies, prompts, documents, skills, command output, or credentials. HTTP success proves no loaded, injected, or used state.

## Consequences

An end-to-end fixture loses a post-commit response, retries the same batch, receives a duplicate result, and verifies one Hub copy plus local acknowledgement. It also verifies authorization-before-body, identity and coordinate binding, HTTPS defaults, immutable construction, bounds, timeouts, runtime persistence, and local operation without Hub.

> Restartable polling is defined by [ADR-0151](0151-restartable-node-outbound-sync-runtime.md).
