# Conversation queues and scheduler

## Queue scheduling

The conversation application owns queue subscriptions and next-wakeup queries. Interaction deadlines include current integration/policy/role-bound inbox work and integration-bound delivery work. Deliberation deadlines include queued request times and lease expiry. These values schedule a check; they neither claim nor authorize a job.

Serial background loops coalesce notifications received during work, avoid overlap, and dispose timers/subscriptions on stop. Idle subscribed loops recover every 30 seconds. Future deadlines wake at their due time; overdue or failed work retains the configured bounded retry interval instead of spinning. Pending uncertain-result reconciliation retains its existing retry count and interval. Legacy injected applications without notification support retain prior scheduling.

## Bounded unattended scheduler

The explicit bounded unattended scheduler watches event-database/WAL changes and kill-switch replacement. A hint interrupts idle waiting; recovery uses the configured interval. Failed claims retain their delay. Lock ownership, current policy, writer leases, kill-switch checks, runtime limits, and cycle/run budgets are rechecked before effects.
