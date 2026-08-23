# ADR-0039: Authenticate and Scope Projects Before Trace HTTP Reads

- Status: `accepted`
- Decision date: 2026-08-19

## Context

Bounded trace readers lacked user identity and project authorization. Reading every source and filtering afterward would expose unauthorized data to application memory and query cost, and could reveal project existence before authorization. Before adding a web view, HTTP requires fixed authentication, scope, external cursors, error bodies, and response limits. It remains read-only and grants neither synchronization commands nor remote execution.

## Decision

### Project-scoped reader

- For each request, `HubRequestAuthenticator` returns `principalId` and at most 256 allowed destination and project coordinates.
- Create `HubProjectScopedTraceReader` only after authentication.
- Every resolved-source query requires scope `all` or explicit `projects`. Only internal operations may use `all`; HTTP always uses `projects`.
- Apply list scope in the SQL `WHERE` clause, never by filtering responses.
- Reject out-of-scope project or run details as `project_forbidden` before source access, so a 403 response reveals no registration state.

### Read-only v1 routes

```text
GET /v1/trace/projects?limit=<n>&cursor=<token>
GET /v1/trace/projects/<projectId>?destinationId=<id>&limit=<n>&cursor=<token>
GET /v1/trace/projects/<projectId>/runs/<runId>?destinationId=<id>&limit=<n>&cursor=<token>
```

- The default limit is 50 and the maximum is 100.
- A cursor is base64url canonical JSON containing version and kind. Reject cross-kind reuse, unknown fields, duplicate or unknown query parameters, and noncanonical encoding with 400.
- A cursor is neither encryption nor authority; authenticate and scope every request.
- Responses contain `schemaVersion: 1` and only existing bounded pages.
- The default response maximum is 1 MiB and may be configured up to 16 MiB. Overflow returns fixed `response_too_large`, never partial JSON.
- Every response sets `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.

### Authentication and errors

The initial adapter uses configured bearer credentials containing 32–4096 visible, whitespace-free ASCII characters. It retains only SHA-256 digests as in-process lookup keys and maps matches to configured principals and scopes. This establishes bearer equality only—not federation, JWT, organization roles, or node-peer authentication—and remains replaceable behind the same port.

- Authentication failure returns 401 `unauthorized` and `WWW-Authenticate: Bearer`, without distinguishing reasons.
- Out-of-scope access returns 403 `forbidden`.
- Unknown routes return 404; unsupported methods return 405; invalid schemas, cursors, or queries return 400.
- Only absence from an authorized source returns `project_not_found` or `run_not_found` with 404.
- Source, read, and unexpected failures return detail-free 500 `internal_error`.

Responses never contain Authorization, token or digest, or principal ID. Errors never echo request values, exceptions, SQL, credentials, or event payloads. Event pages contain only Hub-allowlisted events. The API adds no telemetry and writes no source or index. HTTP success does not prove context use, execution, synchronization, or human identity.

Node HTTP and SQLite fixtures verify authentication before queries, authorization before source calls, SQL-level list scope, fail-closed source contract violations, cursor round trips and type rejection, query rejection, and oversized-response handling.

## Consequences

Web views depend only on the authenticated API. Authentication, parsing, cursor encoding, response policy, and dispatch remain separate, while authorization and bounded querying remain invariant.
