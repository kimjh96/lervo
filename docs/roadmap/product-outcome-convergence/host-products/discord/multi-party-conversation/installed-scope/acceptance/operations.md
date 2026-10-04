# Operational acceptance

The owner already authorized product-owner-to-hired-agent and hired-agent-to-hired-agent operation. The capability remains deployed while technical acceptance is open; earlier authorization is not a missing-consent blocker.

Closing acceptance requires one two-direction evidence run proving exactly one processing and exactly one publication for every request across normal, redelivered, failed, retried, and restarted turns. For each request identifier, correlate durable inbox, participation-decision, outbox, and interlocutor-focus rows with the observed channel result.

The failed-delivery branch must distinguish a nonce-reused earlier Discord message from publication of the requested outbound. A mismatch remains unacknowledged and must not be sent again. Component duplicate-suppression, focus-recovery, and ownership coverage do not replace this run.

The outbox has a bounded `attention_required` state and a Discord-only externally verified reconciliation path under ADR-0424. Uncertain or failed sends are not silently counted as published. Operational approval requires no unresolved attention state for the exact acceptance requests. Recovered historical messages support incident evidence but do not replace the two-direction matrix.
