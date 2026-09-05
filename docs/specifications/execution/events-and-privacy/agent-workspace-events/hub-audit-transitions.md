# Hub audit transitions

Workspace payloads follow the shared [workspace privacy contract](../agent-workspace-events.md#workspace-privacy-and-failure).

## Reservations

`workspace.reservation.granted`, `workspace.reservation.renewed`, `workspace.reservation.released`, and `workspace.reservation.expired` retain project and repository identity, opaque reservation, assignment, workspace and Node IDs, scope and target digests, generation, expiry, idempotency digest, transition, and time. They are not local execution events and grant no repository authority.

## Summaries

`workspace.summary.recorded` is a Hub-only append-only audit transition. It requires project and repository identity hashes, opaque workspace, assignment and Node IDs, generation, previous and next lifecycle states, host kind, bounded process observation and terminal count, optional integration and cleanup-plan IDs, content hash, and acceptance time. It excludes paths and host-native instance coordinates.

The first summary must be `provisioning`; generation and state transitions are monotonic. Duplicate content is idempotent. Unknown-parent, stale, capacity, or authentication failure records no new summary audit row and changes no local state.
