# Scheduler change wakeups

## Implementation boundary

`apps/cli/src/unattended-scheduler-change-wait.ts` provides advisory wakeups for the bounded unattended scheduler. Notifications do not authorize a claim or provider run. The scheduler must recheck its lock, policy, leases, and kill switch under the [scheduler contract](../specifications/execution/unattended-scheduling.md).

The helper watches the parent directories of the repository event database and selected kill-switch path using nonpersistent watchers. Database notifications match the database filename or its `-wal` filename; kill-switch notifications match its filename. A notification without a filename also wakes the wait.

A pending notification makes the next wait return immediately. Otherwise, the wait ends on a notification or its supplied timer. During the wait, a nonpersistent one-second recovery interval checks the kill-switch path with `lstat`. An existing entry or an error other than `ENOENT` ends the wait. This observation only requests a scheduler recheck.

Watcher setup failure leaves timer recovery available. A watcher error closes that watcher and requests a wakeup. Closing the helper closes its watchers and releases an active wait.

## Evidence limits

These statements describe the supplied helper source. They do not establish caller integration, reliable notification delivery on every filesystem, installed scheduler acceptance, or preemption of an in-flight provider call. Canonical execution authority and completion evidence remain with the existing scheduler, workforce, and managed-run contracts.
