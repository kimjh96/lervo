# ADR-0050: Principal-bound conversation command review with separate approval

Status: `accepted`
Decision date: 2026-08-20

## Context

Messages, reactions, and model interpretation must never approve remote commands. Slack, Discord, and native chat require identical semantics, and a review link must not open for a different Hub bearer principal. Existing signed approvals and Hub-free local runs remain unchanged.

## Decision

- `@lervo/conversation-control` revalidates message bytes, digest, count, and UTF-8, and recognizes only exact `/lervo command <delivery-id>` or `/lervo approval <delivery-id>`. Never infer approval from natural language or reactions.
- Responses use the interaction responder and publish only `chat` Markdown with a valid writing permit. They neither deliver directly nor author policy.
- Participant binding identifies project and participant, Hub principal, destination, and `command.read` or `approval.review`.
- `@lervo/hub-control` creates HMAC-SHA256 review grants bound to principal, destination, project, delivery, and expiry. Grants contain no principal source, default to 10 minutes, and are capped at one hour.
- Put the four coordinates and grant in a link fragment; the browser removes it from the address immediately.
- The command-review GET route requires bearer project scope with `command.read` and a matching `x-lervo-control-review` grant before building a read model. Return only delivery status and times, role, provider, risk, suites, current policy snapshot, and per-capability or path approval status. Exclude the request, command signature and hash, approver subject, and internals.
- `/control` is a data-free shell. Keep its token only in tab memory. Buttons call existing policy approval POST routes. A grant authorizes review only; signed approval separately requires reauthenticated `approval.write` or `policy.write`.

Derive `unavailable`, `denied`, `not_required`, `approval_required`, `partially_approved`, or `approved` from current command, policy, approval, and revocation state on every read. `hadRevokedApproval` reveals neither reason nor approver and creates no stored state or event.

Use bounded fixed failures for invalid command, access, source, artifact, and writing. Map invalid, authentication, forbidden, absent, and source errors to HTTP 400, 401, 403, 404, and 500 without echoing tokens, grants, principals, commands, or exceptions. Conversation replies omit principal, project identity, request artifact, and approval IDs. Fragments contain neither bearer nor principal.

Fixtures reject natural-language commands and cross-principal or expired grants, require writing permits, prove review creates no approval, enforce denial for read-only bearers, exercise partial, full, and revoked derived states, and verify data-free safe browser handling.

## Consequences

Every platform uses one responder and outbox with no alternative approval semantics. Local execution remains Hub-independent. Discord Gateway and interactive buttons are not yet claimed complete.
