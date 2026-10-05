# Background scheduling and authority history

- [Background lifecycle and recovery](background-and-history/background-lifecycle.md): scheduling, shutdown, and durable recovery.
- [Authority history](background-and-history/authority-history.md): incremental verification, audit deadlines, and invalidation.
- [Event history cursors](background-and-history/event-history-cursors.md): incremental presence, lineage and review reads, and lapsed-deadline backoff.

## Delivery boundary

The application can use the concrete [automatic topology materializer](../automatic-topology.md) and [workforce and task sources](../workforce-planning.md). Separate delivery work remains:

- Production startup.
- Complete task-derived readiness and planning.
- Concrete external execution.
- Interrupted assignment claims.
- Abandoned-owner recovery.

The background API does not establish installed Discord acceptance.
