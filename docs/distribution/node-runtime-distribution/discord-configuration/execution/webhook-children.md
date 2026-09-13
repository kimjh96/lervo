# Discord webhook workforce children

When a product-owner deployment allows both workforce hire and incoming-webhook creation, hiring also:

1. Prepares a distinct child webhook in the current project channel.
2. Writes owner-readable-only credential and recovery state.
3. Binds active organization membership, external deployment, and channel membership as canonical repository events.
4. Atomically adds the child deployment to the Node configuration only after binding succeeds.
5. Requests a supervised restart after the hire response is acknowledged.

The child receives its own interaction history, provider session, role, and work evidence.

Reconciliation is bidirectional. When a direct child becomes retired, Lervo deletes its incoming webhook, removes its runtime deployment and owner credential, and ends its organization deployment, channel membership, and team membership before the Node restarts. Repeated reconciliation treats an already deleted webhook as converged.

Webhook children are visibly distinct but cannot provide native Discord member presence or typing; those capabilities require a separately installed application bot. Discord cannot natively mention a webhook, so Lervo recognizes an exact leading `@DisplayName` as a surface-neutral participant address and routes the turn to that hired child.
