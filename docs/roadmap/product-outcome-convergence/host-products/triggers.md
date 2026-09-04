# Safe repeatable triggers

Outcome: repeatable work is triggered safely.

State: `partial`.

Exact assignment routines materialize from one manual trigger. Cron, webhook, API, approval-resolution, and assignment wakeups are not installed.

Completion proof: add each trigger behind a versioned adapter and shared idempotency, authority, budget, and recovery contracts.
