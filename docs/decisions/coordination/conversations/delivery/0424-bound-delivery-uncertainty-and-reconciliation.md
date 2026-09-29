# ADR-0424: Bound uncertain conversation delivery and require verified reconciliation

- Status: accepted
- Decision date: 2026-09-19

## Context

An Elio outbound created on 2026-09-10 remained `pending` after more than 143,000 delivery attempts. Discord had posted its message once, but the platform replay record remained `sending`. Later runtime serialization generated a different request hash for the same immutable outbound. Replay correctly refused another send, while the interaction outbox retried every five seconds. The generic `adapter_delivery_failed` row could not distinguish this state from a transient pre-send error. An already posted message must neither be resent nor silently claimed as undelivered.

## Decision

### Bound attempts and separate acknowledgement from callbacks

The platform replay request hash remains immutable. Matching outbound IDs do not make a changed hash a compatible send request.

The interaction delivery worker defaults to three attempts, configurable only from one through ten. An invalid delivery receipt immediately requires attention. Exhausted adapter failures move the leased outbox to `attention_required` instead of scheduling another retry.

Delivery failures and callback exceptions must not share one catch. Check the adapter result first, persist the verified receipt second, and run post-delivery callbacks only after acknowledgement.

### Preserve uncertain delivery as durable state

`attention_required` is a durable outbox state, not a delivery receipt. It:

- Requires immutable outbound and source IDs, integration and role, a positive attempt count, bounded `last_failure_code`, and failure time.
- Has no lease, receipt, or delivered time.
- Is excluded from automatic claims and wakeups, including across restart.
- Stores only content references and bounded codes, excluding provider text, credentials, and raw message content.

`adapter_delivery_failed` means the adapter produced no acknowledged result; it does not prove the platform did not post the message. `invalid_delivery_receipt` means the adapter returned a result that failed the common receipt contract. Neither code authorizes automatic resend after the attempt bound.

### Require verified Discord reconciliation

An operator or agent may use read-only inspection and the explicit `--apply` reconciliation command only with one observed message ID. Reconciliation verifies these against the immutable outbound:

- Installed speaker principal.
- Exact channel or thread.
- Reply relation where Discord supports it.
- Byte count and SHA-256 content hash.
- Delivery time.

Before applying, it rechecks the stored attempt, failure, replay hash, and content hash. Platform replay transitions from `sending` or `unknown` to `delivered` only with that externally verified message. Message correlation is recorded next, followed by a compare-and-set outbox receipt. These steps are idempotent so interrupted reconciliation can resume.

A rejected replay, mismatched identity or content, or changed store state remains unresolved; no new Discord send is attempted. A bot-native reply is verified against its source message. Webhook delivery must not be described as a native reply.

### Validate Discord create-message results

Before completing replay, the bot REST adapter checks the message object returned by Discord's create-message call. Channel, content, and requested native reply target must match; a returned nonce must match when present.

[Discord's create-message contract](https://docs.discord.com/developers/resources/message#create-message) permits `enforce_nonce` to return an earlier message instead of creating one when the same author recently used that nonce. A mismatched returned message therefore represents uncertain delivery, not acknowledgement, and cannot become a conversation outbox receipt. This guard is independent of assignment-stage nonce separation and protects against other accidental nonce reuse without publishing another message.

### Preserve storage and evidence contracts

The version-2 interaction SQLite migration preserves existing inbox, decision, outbox, attempts, receipts, and content references while adding the new state and protected transitions.

`attention_required` may become `delivered` only through exact receipt reconciliation; it cannot return to `pending` or `leased`. No new global event is added. The outbox and platform replay remain canonical evidence. Read-only projections must not infer publication without a receipt.

## Consequences

Uncertain or permanently invalid sends stop consuming unbounded retries without pretending the human saw a response.

Installed conversation approval still requires the separate human-authored, two-direction evidence matrix covering normal delivery, redelivery, failure, retry, and restart. Successful reconciliation proves that the identified message exists and matches the outbox. It does not alone prove the entire multi-agent approval matrix or the absence of every possible duplicate outside the observed Discord window.
