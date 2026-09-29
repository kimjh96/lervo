# Reader compatibility

Event-reader compatibility is a provider-neutral, rebuildable capability observation, not writer authority. Local diagnostics and Node health advertise readable envelope versions. Hub exposes the same secret-free report through an identity-bound health endpoint that sync clients read without sending bearer credentials.

Missing or incapable peers cannot authorize v2 writing. Local execution and v1 writing remain independent of Hub availability.

For a Hub-enabled project, the existing owner-only Node fleet registry is the complete configured membership authority. The service definition and runtime config bind its Node and Hub observation sources. Planning and apply each re-observe exact capability and identity without creating another reader registry.

A Hub-enabled clone with no registered Node on its host has only the local runtime as a reader: only a Node synchronizes repository events to Hub. Its evidence carries `repository_node_absent_v1` authority with that single reader. Any registration matching the project or root, even a stale one, requires full fleet observation. See the [ADR-0332 amendment](../../../decisions/operations/trace/0332-authoritative-distributed-event-reader-inventory.md).
