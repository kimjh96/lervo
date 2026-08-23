# ADR-0145: Authenticated, Node-Scoped Remote Command Delivery

- Status: accepted
- Decision date: 2026-08-22

## Context

Durable commands and reconnect workers lacked a real HTTP transport, and acknowledgement storage was not rebound to destination, project identity, and Node below the route layer.

## Decision

@lervo/hub exposes project-scoped lease and acknowledgement POST routes. Bearer authentication, command.delivery permission, destination/project scope, and principalId=nodeId are checked before bodies. Hub time owns lease and confirmation times. Lease duration is 1 second–5 minutes and limit 1–16. Requests default to 256 KiB, responses 1 MiB; non-JSON, unknown/duplicate query, and invalid routes fail. Responses use no-store and a Hub identity header.

Acknowledgement storage requires destination, project/identity, and Node and rechecks current registration and lease owner transactionally. Duplicate terminal acknowledgements require identical hashes and scope.

AuthenticatedRemoteCommandHttpTransport fixes HTTPS base URL, bearer, expected Hub identity, destination, Node, and project at construction. URLs reject credentials/query/fragment; HTTP is fixture-only. It sends bounded JSON with a 15-second default timeout and validates status, content type, Hub identity, and all coordinates before the worker sees a body. The header supplements, not replaces, TLS. Lease time is checked against post-response current time.

A separate polling lifecycle serializes cycles, waits bounded intervals for idle/deferred outcomes, continues after processed batches, and obeys AbortSignal. It owns no process, service, credentials, or logs.

Tokens exist only in memory and Authorization headers. No raw request, provider output, or internal exception is stored. HTTP codes distinguish authentication, authorization, absence, invalid input, conflict, size, and internal failure. Node normalizes transport failures to hub_unavailable or transport_authentication_failed without new queue states/events.

## Consequences

Real HTTP now preserves durable replay: an integration fixture loses the first acknowledgement, restarts Hub/Node databases and server, and confirms one executor call with the second acknowledgement committed. Authorization-before-body, size limits, identity failure, polling serialization, and abort behavior are verified. This does not claim an installed daemon or production TLS deployment.
