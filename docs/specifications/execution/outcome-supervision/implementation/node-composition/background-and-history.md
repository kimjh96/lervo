# Background scheduling and authority history

- [Background lifecycle and recovery](background-and-history/background-lifecycle.md): scheduling, shutdown, and durable recovery.
- [Authority history](background-and-history/authority-history.md): incremental verification, audit deadlines, and invalidation.

## Delivery boundary

The application can use the concrete [automatic topology materializer](../automatic-topology.md) and [workforce and task sources](../workforce-planning.md). The following remain separate delivery work:

- Production startup.
- Complete task-derived readiness and planning.
- Concrete external execution.
- Interrupted assignment claims.
- Abandoned-owner recovery.

The background API does not establish installed Discord acceptance.
