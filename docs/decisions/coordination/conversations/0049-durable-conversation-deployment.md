# ADR-0049: Restartable conversation deployment composition

Status: `accepted`
Decision date: 2026-08-20

## Context

Adapter ports alone cannot reconnect external replies to canonical events after restart. Retrying a lost API response may duplicate a reply. Deployment must compose credential transport, reversible identity mapping, and delivery state without leaking raw external IDs into interaction state.

## Decision

### Identity and storage

- `ConversationPlatformIdentityPort` persists the external message address-to-canonical-event mapping before accepting inbound. Outbound correlation binds integration, tenant, conversation, external message, outbound ID, source event, and automation depth without overwriting conflicts.
- An agent participant without Lervo outbound correlation receives depth 8, preventing automatic conversations with external bots.
- `@lervo/conversation-platform-sqlite` stores conversation, participant, and thread bindings, correlations, and delivery replay in a separate `0600` database because reversible external IDs are required. Thread IDs derive deterministically from the first external address.
- The platform database stores one compare-and-set ingress cursor per external conversation. A fresh Discord deployment uses the latest visible message as its baseline without replaying pre-install history. Schema migration seeds existing Discord cursors from the newest durable message correlation.

### Delivery

- Before an API call, persist platform, integration, outbound ID, request hash, `sending`, and attempt time. Mark `delivered` only after verifying an external message ID.
- Explicit rejection becomes `rejected`; an unknown response or leftover `sending` after restart becomes `unknown`. None auto-retry, preventing duplicate delivery at the cost of operator reconciliation.
- Slack transport uses bearer OAuth, escaped plain text, and disabled mrkdwn. It rejects observation-only publications until the installed Slack contract can preserve that classification on re-entry.
- Discord uses a bot token, empty allowed mentions, disabled reply mention, and an outbound-derived enforced nonce. The versioned nonce preserves the additive eligible-versus-observation-only classification without changing visible text; Gateway and history intake restore it only on agent-authored messages. Discord webhooks cannot preserve the classification and reject observation-only delivery before network use.
- Bound time, size, content type, and response message ID. Never expose credentials in errors.

### Composition and ingress recovery

- `apps/conversation` composes CAS, stores, adapters, and delivery per integration. A separate driver owns Discord WebSocket Identify, Resume, heartbeat, and reconnect; the application entrypoint does not claim them.
- After Discord READY or RESUMED, the application retrieves messages after the durable channel cursor through the bot-authenticated REST history adapter. It processes at most 1,000 messages oldest-first through the same identity, interaction, publication, and delivery path as Gateway intake. The cursor advances only after each message settles, including ignored self messages. Address drift, cursor conflict, an invalid response, or an exceeded bound fails startup reconciliation.

### Privacy and failures

Raw external IDs exist only in mapping SQLite, never in normalized, interaction, or global events. Credentials and Gateway handles are not persisted. Mapping conflicts preserve old values and fail with `identity_mapping_failed`. Credential, response, and unknown replay failures use `platform_delivery_failed` and produce no receipt.

`platform_ingress_failed` means authenticated history could not be retrieved or validated; it prevents cursor advance and readiness. The ingress cursor is platform-local recovery state with no message body. Add no event.

### Validation

Fixtures prove:

- Restart recovery for threads, replies, depth, receipts, and ingress cursors.
- Conflict preservation.
- Slack and Discord credential request constraints.
- One API call on successful replay.
- No resend after an unknown outcome.
- Oldest-first Discord history recovery.
- Safe first-install baselining.
- Reconnection of a Slack reply to its canonical event after restart.

## Consequences

Unknown-delivery reconciliation and command/approval conversation UX remain separate. Chat messages and reactions never become approval sources.
