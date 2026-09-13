# Node idle hint protocol

## Requests and authentication

`GET /v1/runtime-changes/projects/<projectId>` accepts exactly one `destinationId`, `repositoryIdentityHash`, and `topic=workstream|command`, with optional `cursor`. Command subscriptions also require exactly one `nodeId` matching the authenticated principal; workstream requests exclude `nodeId`. Unknown or duplicated query keys are invalid.

Workstream subscriptions use `workstream.read`; command subscriptions use `command.delivery`. The corresponding sync or command authenticator must authorize the exact destination/project. The SQLite source verifies the registered repository identity before waiting and again before returning. A held response rechecks that principal, scope, and permission. HTTPS and the expected Hub identity header remain mandatory outside explicit test transports.

## Responses and recovery

Responses contain only `schemaVersion: 1`, an opaque UUID `cursor`, and `status: changed|timeout`; they contain no durable event position. Either status requires the Node to check durable state.

New cursors trigger immediate reconciliation to cover changes between cycle completion and initial subscription. Existing cursors preserve intervening notifications in process memory. Other Hub processes, missed notifications, lease expiry, and future-ready commands are discovered by the 25-second timeout. Notification cursors never replace durable event or command cursors.

| State | Required fields | Meaning and failure boundary |
| --- | --- | --- |
| `changed` | schemaVersion, cursor, status | Reconcile durable state; neither publication nor execution is proved. |
| `timeout` | schemaVersion, cursor, status | The held wait ended without a newer in-process hint; reconciliation is still required. |
| Local pending hint | one boolean per loop | Coalesces changes before or during a wait; carries no event contents. |
| Notification retry cooldown | next retry time, cleared cursor | After invalid/unsupported/unavailable transport, use the configured legacy idle interval and retry notification support after 60 seconds. |

## Failures and limits

| Condition | HTTP status | Internal code |
| --- | --- | --- |
| Malformed request | 400 | — |
| Absent credentials | 401 | — |
| Forbidden scope | 403 | — |
| Unsupported source | 404 | — |
| Missing or changed registration | 409 | `registration_required` |
| Exhausted notification capacity | 429 | `capacity_exceeded` |
| Closed or unavailable source | 503 | `source_closed` or generic internal failure |

No failure returns submitted query contents or credentials. Each store permits at most 1,024 retained scope entries and 1,024 active waits. Eviction excludes active entries; shutdown releases all waits. Responses are limited to 1,024 bytes. Client abort cancels both the HTTP request and server wait. Ordinary notification requests use a 30-second client deadline around the 25-second server wait.
