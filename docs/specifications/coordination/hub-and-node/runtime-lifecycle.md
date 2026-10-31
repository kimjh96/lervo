# Runtime lifecycle

- [Health and stabilization](runtime-lifecycle/health-and-stabilization.md): component health, service continuity, and readiness evidence.
- [Repository upgrades](runtime-lifecycle/repository-upgrades.md): registered Node reconciliation, deployment identity, and unresolved work.
- [Bounded offline replacement](runtime-lifecycle/bounded-offline-replacement.md): offline upgrade currency and replacement readiness conditions.

## Installed runtime retention

[ADR-0534](../../../decisions/operations/storage/0534-bound-installed-runtimes-and-convergence-artifacts.md) bounds managed Node runtime directories on Mac and WSL. Successful deployment or rollback retires obsolete managed runtimes from an inventory capped at 4,096 entries. `lervo upgrade` exposes a `runtime_retention` stage with candidate names, exact metadata identities and byte totals. Apply reobserves consumers and removes only its approved intersection.

The keep set contains `current`, live physical PID bindings and process command references, managed service executable/configuration references, the last distinct rollback predecessor per service and every locally observed signed-rollout enrollment predecessor, and the newest two other runtimes. Bindings record `schemaVersion: 1`, `processId`, `processIdentity` and `runtimeDirectory`; they stay private, have at most 256 entries per runtime, and stop protecting a runtime when their process is absent. A binding failure leaves runtime work available and cleanup deferred when a `current` process cannot be resolved. Existing unbound processes need their ordinary replacement before cleanup can proceed.

Only the generated hash-name, payload, launcher and known layout qualify. Internal dependency links are checked without traversal; external links and foreign files are protected. A host lock serializes publication, activation, pins and retirement. One private detach journal makes interrupted removal resumable. Rollback pins replace one predecessor per service-path digest and retain locally observed enrollment predecessors, up to 1,024 entries and four MiB. Signed rollout apply pins the enrolled executable before service effects. An unresolved enrollment keeps the existing managed inventory. `runtime_references_unavailable` means retirement is deferred, not that no runtime is in use. No service is stopped for maintenance.

The rollback-pin file requires `schemaVersion: 1` and a `pins` map from a service or enrollment scope digest to runtime directory names. The retirement journal requires `schemaVersion: 1`, the original runtime `name`, and its exact local `tombstone` name. Unknown versions, malformed coordinates, active locks and unsafe paths refuse retirement. Neither file contains executable bodies, configuration text or credentials.

Physical bindings reuse the process-birth observer from `node-work-admission` under ADR-0504. Only a matching birth identity can explain a command started through `current`. A reused PID, legacy binding without birth evidence, a different observation scheme or unknown metadata cannot establish that match. Proven absence or a changed birth within the same scheme permits stale-binding protection to end. Birth hashes remain local; boot identifiers and raw process start times are not stored in retention state.
