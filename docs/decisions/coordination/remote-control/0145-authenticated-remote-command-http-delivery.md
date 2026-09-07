# ADR-0145: Authenticated, Node-Scoped Remote Command Delivery

- Status: accepted
- Decision date: 2026-08-22

## Context

Durable commands and reconnect workers lacked an HTTP transport. Below the route layer, acknowledgement storage was not rebound to destination, project identity, and Node.

## Decision

`@lervo/hub` exposes project-scoped lease and acknowledgement POST routes. Before reading bodies, it checks bearer authentication, `command.delivery` permission, destination/project scope, and `principalId=nodeId`. Hub time determines lease and confirmation times. Lease duration is 1 second–5 minutes; limit is 1–16. Default bounds are 256 KiB for requests and 1 MiB for responses. Non-JSON, unknown or duplicate query parameters, and invalid routes fail. Responses use `no-store` and a Hub identity header.

Acknowledgement storage requires destination, project/identity, and Node, and transactionally rechecks current registration and lease owner. Duplicate terminal acknowledgements require identical hashes and scope.

`AuthenticatedRemoteCommandHttpTransport` fixes the HTTPS base URL, bearer credential, expected Hub identity, destination, Node, and project at construction. URLs reject credentials, query, and fragment; HTTP is fixture-only. It sends bounded JSON with a 15-second default timeout and validates status, content type, Hub identity, and every coordinate before exposing a body to the worker. The identity header supplements TLS.

Lease time is checked against current time after the response. A trusted Hub `leasedAt` may lead the Node clock only within the receiver's bounded clock-skew allowance; lease expiry remains strict. When this bounded lead occurs, the acknowledgement lower bound uses authenticated Hub `leasedAt` so a completed local effect is not represented as preceding its lease.

A separate polling lifecycle serializes cycles, waits bounded intervals after idle or deferred outcomes, continues after processed batches, and obeys `AbortSignal`. It owns no process, service, credentials, or logs.

Tokens exist only in memory and `Authorization` headers. No raw request, provider output, or internal exception is stored. HTTP codes distinguish authentication, authorization, absence, invalid input, conflict, size, and internal failure. Node normalizes transport failures to `hub_unavailable` or `transport_authentication_failed` without adding queue states or events.

## Consequences

Real HTTP preserves durable replay: an integration fixture loses the first acknowledgement, restarts Hub and Node databases and server, and confirms one executor call with the second acknowledgement committed. Fixtures also verify authorization before body parsing, size limits, identity failure, polling serialization, and abort behavior. This decision claims neither an installed daemon nor a production TLS deployment.
