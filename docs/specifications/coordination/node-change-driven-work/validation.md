# Remaining timers and acceptance

## Remaining timers

| Purpose | Normal trigger | Timer retained for |
| --- | --- | --- |
| Node event/workstream sync | Local committed-head hint or authenticated Hub held request | Lost hints, remote future-ready work, unsupported peers, deferred retry |
| Remote commands | Authenticated Hub hint | Policy/lease checks and deferred retry |
| Repository replicas | Filesystem or persistent SSH hint | Missed changes and reconnection |
| Native replica readiness | Atomic receipt replacement after a request | Missed receipt notification and work deadline |
| Repository conversation signals | Committed event-head hint | Lost notification and bounded backlog processing |
| Conversation retry/delivery and deliberation | Queue/WAL hint or next eligible deadline | Lease expiry, uncertainty recovery, failed work, missed notification |
| Supervision request admission | Owner-lease SQLite/WAL hint | Missed notification within the bounded admission deadline |
| Explicit unattended scheduler | Event/WAL or kill-switch change | Bounded recovery and failure delay |
| Workstream integrity | Full validation at startup and scheduled audit | Required integrity revalidation, distributed over 45–60 seconds |
| Discord Gateway, typing, worker leases | Existing socket or active work lifecycle | Protocol heartbeat, typing expiry, ownership renewal |

Periodic health, retry, and integrity observations must not be described as entirely timer-free. The independent Arca CPU burst investigation is outside this change.

## Acceptance

- Idle subscribed workers do not run at their former short polling interval.
- Source changes and readiness requests wake the intended replica. Ignored file edits wake nothing, and directory churn never reopens a macOS or Windows watch handle.
- Bursts coalesce, changes during work remain pending, and cancellation releases local and remote resources.
- A freed reconciliation slot admits a newly eligible repository without waiting for unrelated active work. Owner-lease release wakes request admission without a 100 ms retry loop.
- Concurrent unrelated event writes preserve a supervision observation. Changed workstream, assignment, agent, authority, or task-digest coordinates still reject it.
- Old peers, lost notifications, watcher failure, reconnect, and restart recover through authoritative verification.
- Git snapshot, bundle, rollback, staged/unstaged content, deletion, and divergence tests retain their existing results.
- Queue eligibility, future work, lease expiry, current-policy filtering, and shutdown preserve authority and timing.
- Audit distribution never extends the existing maximum integrity window; state changes publish health immediately.
- Installed artifacts exercise notification and snapshot behavior independently of unit tests. Production CPU claims require their own measured windows.
