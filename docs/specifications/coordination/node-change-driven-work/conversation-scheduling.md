# Conversation queues and scheduler

## Queue scheduling

The conversation application owns queue subscriptions and next-wakeup queries. Interaction deadlines include current integration/policy/role-bound inbox work and integration-bound delivery work. Deliberation deadlines include queued request times and lease expiry. These values schedule checks; they neither claim nor authorize jobs.

Serial background loops coalesce notifications received during work, avoid overlap, and dispose timers/subscriptions on stop. Idle subscribed loops recover every 30 seconds. Future deadlines wake when due; overdue or failed work retains the configured bounded retry interval to prevent spinning. Pending uncertain-result reconciliation retains its existing retry count and interval. Legacy injected applications without notification support retain prior scheduling.

Installed supervision request admission subscribes to process-local lease transitions and its owner-lease SQLite/WAL boundary before attempting acquisition. Lease release wakes the exact fenced retry. Recovery for missed cross-process notifications wakes at most once per second and never beyond the existing admission deadline; it is not an idle task-discovery loop. Composed owner observations revalidate owned workstream, assignment, agent, authority, and task-digest coordinates. Unrelated event-store writes do not invalidate them; a relevant concurrent change still fails closed.

## Bounded unattended scheduler

The explicit bounded unattended scheduler watches event-database/WAL changes and kill-switch replacement. Hints interrupt idle waiting; recovery uses the configured interval. Failed claims retain their delay. Lock ownership, current policy, writer leases, kill-switch checks, runtime limits, and cycle/run budgets are rechecked before effects.
