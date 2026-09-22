# Native repository work recovery

Status: `active`

## Purpose

The canonical `conversation.repository_work.completed` event is committed before the local SQLite
turn projection. If the Node stops between those commits, verified work must not be rerun or reported
as a generic response-generation failure.

## Recovery boundary

Startup and exact-source-event re-entry query the deterministic conversation run coordinate rather
than a bounded global event page. Recovery accepts exactly one completion whose source event, worker,
provider, request-content hash, and `verificationStatus: passed` match the interrupted local turn.

Startup reconciliation updates only the local `running` projection. It does not invoke a provider,
publish a message, or replay the source event. Exact-source-event re-entry may publish the stored
provider-authored result after the same reconciliation. A missing completion remains unresolved;
conflicting evidence fails closed as nonretryable `response_effect_unconfirmed`.

Deduplication uses exact source-event identity. Separately authored events remain distinct work even
when their natural-language text and content hash are identical. The application does not emit
fixed duplicate-status prose for either case.

## Persistence and privacy

Recovery adds no canonical event, SQLite table, or persisted field. It reads existing bounded event
coordinates and local turn fields. Request text, provider output, credentials, and native diagnostics
remain outside SQLite; the existing content-addressed result reference retains its current policy.
