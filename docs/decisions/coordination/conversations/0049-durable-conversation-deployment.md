# ADR-0049: Restartable conversation deployment composition

Status: `accepted`
Decision date: 2026-08-20

## Context

Adapter ports alone cannot reconnect external replies to canonical events after restart, and retrying after a lost API response may duplicate a reply. Deployment must compose credential transport, reversible identity mapping, and delivery state without leaking raw external IDs into interaction state.

## Decision

- `ConversationPlatformIdentityPort` persists external message address → canonical event before accepting inbound. Outbound correlation binds integration/tenant/conversation/external message, outbound ID, source event, and automation depth without overwriting conflicts.
- An agent participant lacking Lervo outbound correlation receives depth 8, preventing automatic conversations with external bots.
- `@lervo/conversation-platform-sqlite` stores conversation/participant/thread bindings, correlations, and delivery replay in a separate `0600` database because reversible external IDs are required. Thread IDs derive deterministically from first external address.
- Before an API call, persist platform/integration/outbound ID/request hash, `sending`, and attempt time. Mark `delivered` only after a verified external message ID.
- Explicit rejection becomes `rejected`; unknown response becomes `unknown`; leftover `sending` after restart also becomes unknown. Neither auto-retries, avoiding duplicate delivery at the cost of operator reconciliation.
- Slack transport uses bearer OAuth, escaped plain text, and disabled mrkdwn. Discord uses bot token, empty allowed mentions, disabled reply mention, and outbound-derived enforced nonce. Bound time, size, content type, and response message ID; never expose credentials in errors.
- `apps/conversation` composes CAS, stores, adapters, and delivery per integration. A separate driver owns Discord WebSocket Identify/Resume/heartbeat/reconnect; the app entrypoint does not claim it.

Raw external IDs exist only in mapping SQLite, never normalized/interaction/global events. Credentials and Gateway handles are not persisted. Mapping conflicts preserve old values and fail `identity_mapping_failed`; credential/response/unknown replay failures are `platform_delivery_failed` and produce no receipt. Add no event/state.

Fixtures prove restart recovery of threads/replies/depth/receipts, conflict preservation, Slack/Discord credential request constraints, single API call on successful replay, no resend after unknown outcome, and a Slack reply reconnecting to its canonical event across restart.

## Consequences

Discord Gateway driver, unknown-delivery reconciliation, and command/approval conversation UX remain separate. Chat messages/reactions never become approval sources.
