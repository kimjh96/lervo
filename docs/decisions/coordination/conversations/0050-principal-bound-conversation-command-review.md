# ADR-0050: Principal-bound conversation command review with separate approval

Status: `accepted`
Decision date: 2026-08-20

## Context

Messages, reactions, and model interpretation must never become remote-command approval. Slack, Discord, and native chat need identical semantics, and a review link must not open for a different Hub bearer principal. Existing signed approvals and Hub-free local runs remain unchanged.

## Decision

- `@lervo/conversation-control` revalidates message bytes/digest/count/UTF-8 and recognizes only exact `/lervo command <delivery-id>` or `/lervo approval <delivery-id>`. Never infer natural-language approval or reactions.
- Responses use the interaction responder and publish only `chat` Markdown with a valid writing permit. They neither deliver directly nor author policy.
- Participant binding names project/participant, Hub principal, destination, and `command.read`/`approval.review`.
- `@lervo/hub-control` creates HMAC-SHA256 review grants binding principal, destination, project, delivery, and expiry. Grants contain no principal source, default to 10 minutes, and cap at one hour.
- Put four coordinates and grant in a link fragment; browser removes it from the address immediately.
- The command-review GET route requires bearer project scope/`command.read` and a matching `x-lervo-control-review` grant before building a read model. Return only delivery status/times, role/provider/risk/suites, current policy snapshot, and per-capability/path approval status—not request, command signature/hash, approver subject, or internals.
- `/control` is a data-free shell. Keep token only in tab memory. Buttons call existing policy approval POST routes. A grant authorizes review only; actual signed approval separately requires reauthenticated `approval.write` or `policy.write`.

Derive `unavailable`, `denied`, `not_required`, `approval_required`, `partially_approved`, or `approved` from current command/policy/approval/revocation each read. `hadRevokedApproval` reveals no reason or approver and creates no stored state/event.

Use bounded fixed failures for invalid command, access, source, artifact, and writing. HTTP maps invalid/auth/forbidden/absent/source errors to 400/401/403/404/500 without echoing token, grant, principal, command, or exceptions. Conversation replies omit principal, project identity, request artifact, and approval IDs; fragments contain no bearer or principal.

Fixtures reject natural-language commands and cross-principal/expired grants, require writing permits, prove no approval is created by review, enforce read-only bearer denial, exercise partial/full/revoked derived states, and verify data-free safe browser handling.

## Consequences

Every platform uses one responder/outbox and no alternative approval semantics. Local execution remains Hub-independent; Discord Gateway and interactive buttons are still not claimed complete.
