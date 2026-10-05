# Failure fidelity

Every replica failure resolves to a structured failure ([ADR-0456](../../../../decisions/coordination/sync/0456-hand-off-repositories-atomically-with-a-writer-lease.md)):

- `code`: a bounded failure code, such as `repository_replica_snapshot_failed`, `repository_replica_merge_failed`, or `repository_replica_transfer_failed`.
- `stage`: `protocol`, `snapshot`, `bundle`, `transfer`, `verify`, `apply`, `merge`, `checkpoint`, `supersession`, `lease`, or `rollback`. `supersession` exchanges superseded knowledge commits before any history moves. An apply whose automatic rollback cannot be proven reports `rollback`.
- `gitExitCode`: the failing Git process exit code, or null.
- `stderrDigest`: the failing Git or SSH stderr, diagnostically redacted to one line of at most 512 characters, or null.
- `causeChain`: up to eight redacted cause messages, outermost first.

Diagnostic redaction removes private-key blocks, URL credentials, authorization tokens, sensitive-key values, known token formats, and opaque runs of 40 or more characters except Git object IDs and SHA-256 digests. It strips terminal controls.

A failing peer command writes its structured failure as one `lervo-repository-replica-failure-v1` stderr line and exits 1. The SSH peer adapter restores it, preserving a peer Git failure's own stage and digest. Unstructured SSH output becomes `repository_replica_transfer_failed` at `transfer`, with redacted SSH stderr.

The coordinator prints the code, stage, Git exit code, cause chain, and digest. It records the latest failure in the local receipt as `lastFailure` with `occurredAt`, retaining the last proven parity fields. A replica that never reached parity receives an `attention` receipt that readiness never admits.

In watch mode, each distinct failure is logged once. Repeats report only a counter at 10, 100, 1,000, and later powers of ten; the first successful cycle logs the recovery count.

The coordinator writes owner-only health beside its state file (`<state>.health.json`): `degraded` while any configured replica is divergent or failing, otherwise `ready`. It includes each replica's status, open `divergenceId`, or failure code, stage, and consecutive count. In watch mode, it also includes `recoveryIntervalMs`, the current idle recovery sweep interval. This informational field proves neither parity nor freshness.

Diagnostic text stays in local logs and receipts and never enters canonical events.
