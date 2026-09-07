# Capacity, concurrency, and retention

## Bounded admission and integration

Current admission bounds are explicit:

- 256 agents and concurrent leases;
- 10,000 assignments;
- delegation depth eight;
- 64 assignment dependencies or cancellation roots; and
- 32 sources in one workspace integration batch.

Integration order is dependency-ready, then priority, sealed time, and workspace ID. One finite snapshot includes every ready candidate exactly once. FH4 has no unattended general scheduler, so cross-snapshot priority aging and autonomous starvation claims are unsupported rather than inferred. Capacity rejection occurs before mutation. Lease expiry advances generation but never proves an earlier external process stopped.

## Capacity evidence

The evidence names small, medium, large, and concurrent profiles. The current contract observes windows up to 100,000 events, 10,000 assignments, and 32 concurrent workers. These provider-free profiles verify deterministic bounded fan-out and join mechanics; they do not claim provider, network, disk-full, or service throughput.

## Retention

Every growing collection is one of:

- canonical project-lifetime history with an explicit bounded operation window;
- a hard count bound that rejects before mutation;
- current-state replacement;
- acknowledged outbox purge with bounded claims and backpressure;
- a single recoverable journal; or
- typed age, count, and byte pruning for derived state.

Events and referenced CAS artifacts are retained for the project lifetime as canonical evidence and are not silently compacted. A read beyond the 100,000-event operation window, disk exhaustion, or missing durable bytes is an explicit unsupported or recovery-required state, not permission to delete history. Derived knowledge and terminal projections rebuild through their normal producers.
