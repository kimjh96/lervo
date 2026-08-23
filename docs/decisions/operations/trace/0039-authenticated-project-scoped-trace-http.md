# ADR-0039: Authenticate and scope projects before trace HTTP reads

Status: `accepted`
Decision date: 2026-08-19

## Context

Bounded trace readers knew no user identity or project authorization. Reading all source and filtering afterward would expose unauthorized data to application memory/query cost and could reveal project existence before authorization. Before a web view, HTTP needs fixed authentication, scope, external cursors, error bodies, and response limits. It is read-only and grants neither sync commands nor remote execution.

## Decision

### Project-scoped reader

- Per request, `HubRequestAuthenticator` returns `principalId` and at most 256 allowed destination/project coordinates.
- Only after authentication create `HubProjectScopedTraceReader`.
- Every resolved source query requires scope `all` or explicit `projects`; only internal operations may use `all`, while HTTP always uses projects.
- Apply list scope in SQL `WHERE`, never response filtering.
- Reject out-of-scope project/run detail as `project_forbidden` before source access, so 403 reveals no registration state.

### Read-only v1 routes

```text
GET /v1/trace/projects?limit=<n>&cursor=<token>
GET /v1/trace/projects/<projectId>?destinationId=<id>&limit=<n>&cursor=<token>
GET /v1/trace/projects/<projectId>/runs/<runId>?destinationId=<id>&limit=<n>&cursor=<token>
```

- Keep default 50 and maximum 100.
- Cursor is base64url canonical JSON with version and kind. Reject cross-kind reuse, unknown fields, duplicate/unknown query parameters, and noncanonical encoding as 400.
- Cursor is neither encryption nor authority; authenticate and scope every request.
- Responses include `schemaVersion: 1` and only existing bounded pages.
- Default response maximum is 1 MiB, configurable up to 16 MiB. On overflow return fixed `response_too_large`, never partial JSON.
- Every response uses `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.

### Authentication and errors

The first adapter uses configured bearer credentials: 32–4096 visible, whitespace-free ASCII characters. Keep only SHA-256 digests as lookup keys in process memory and map matches to configured principal/scope. This proves only bearer equality—not federation, JWT, organization roles, or node-peer authentication—and remains replaceable behind the same port.

- Authentication failure: 401 `unauthorized` plus `WWW-Authenticate: Bearer`, without reason distinction.
- Out-of-scope: 403 `forbidden`.
- Unknown route: 404; unsupported method: 405; invalid schema/cursor/query: 400.
- Only authorized-source absence returns `project_not_found` or `run_not_found` 404.
- Source/read/unexpected failures become detail-free 500 `internal_error`.

Responses never contain Authorization, token/digest, or principal ID. Errors never echo request values, exceptions, SQL, credentials, or event payloads. Event pages contain only Hub allowlisted events. Add no telemetry and write no source/index. HTTP success proves neither context use, execution, sync, nor human identity.

Node HTTP/SQLite fixtures verify authentication before queries, authorization before source calls, SQL-level list scope, fail-closed source contract violations, cursor round trips/type rejection, query rejection, and oversized-response handling.

## Consequences

Web views depend only on the authenticated API. Authentication, parsing, cursor codec, response policy, and dispatch remain separate while authorization and bounded querying stay invariant.
