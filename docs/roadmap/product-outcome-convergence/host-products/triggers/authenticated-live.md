# Authenticated live trigger adapters

State: `implemented`.

Outcome: authenticated cron, webhook, API, approval-resolution, or assignment-wakeup sources trigger governed work through installed adapters.

The installed `lervo.webhook.hmac-sha256@1.0.0` adapter accepts exact signed HTTP events and invokes a repository-authorized fixed assignment routine through the shared live-trigger contract.

Each accepted live trigger must use a versioned adapter and shared source authentication, idempotency, authority, budget, uncertain-effect, and recovery contracts.

Unit, CLI HTTP, and packed-consumer tests prove authentication, replay, cumulative budget, recovery, retention, privacy, and assignment materialization. This outcome does not claim cron, platform-specific APIs, unattended scheduling, automatic claims, or provider execution.

See [authenticated live webhook trigger v1](../../../../evidence/foundation/authenticated-live-webhook-trigger-v1.md).
