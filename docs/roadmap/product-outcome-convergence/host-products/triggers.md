# Safe repeatable triggers

Outcome: repeatable work is triggered safely.

State: `partial`.

Exact assignment routines materialize from one manual trigger. A separate reviewed-input direct-message adapter routes one content-addressed message into an existing handoff through exact plan/apply and source-event idempotency. Cron, webhook, API, approval-resolution, and assignment wakeups are not installed.

Completion requires each additional trigger to use a versioned adapter and shared idempotency, authority, budget, uncertain-effect, and recovery contracts. The reviewed direct-message adapter proves the local handoff pattern, not unattended scheduling or live platform receipt.
