# Repository Node fleet implementation and acceptance

## Required work

1. Replace the global singleton with stable per-repository service identity derived from safe project and node coordinates.
2. Maintain a local fleet registry binding project ID, repository identity hash, repository root, node ID, destination ID, runtime version, service identity, and health path without bearer-token bytes.
3. Have onboarding plan and reconcile Hub registration, scoped credentials, a repository Node instance, native service activation, and three-observation readiness. Only credential issuance, external registration, or other authority boundaries may require approval.
4. Reconcile moves through manifest identity and an explicitly verified new physical root; folder names never define identity.
5. Upgrade runtime payloads and service definitions transactionally, retaining the last working version until replacement readiness. Recover crash loops without weakening validation. Supervised Node upgrades must hold the owner fence before stopping a live service and refuse busy cycles without interruption. Separately prove an all-work drain for independent conversation turns.
6. Repair Shiflo's `startup_failed` and `local_batch_invalid` without discarding, rewriting, or pretending to synchronize local event history.
7. Independently register and activate a second acceptance repository; prove both services stay active and synchronize concurrently on the same Mac.
8. Report event sync, workstream replication, and remote control separately per repository. Aggregate status must identify the affected project and recovery action.
9. Keep workstream publication and import automatic, ancestry ordered, idempotent, privacy bounded, and fail closed on divergence. Never copy approval authority, transcripts, credentials, or provider reasoning.
10. Add clean-install, upgrade, relocation, restart, offline-recovery, two-repository, two-node, and divergent-head acceptance scenarios using installed artifacts, not only in-process fixtures.

## Completed implementation

Completed under [ADR-0202](../../../decisions/operations/services/0202-repository-node-fleet-identity-and-registry.md), [ADR-0203](../../../decisions/operations/services/0203-read-only-repository-node-onboarding-reconciliation.md), and the subsequent exact-apply contract:

- Node rendering and management require a deterministic repository-node instance ID. Systemd and launchd identities no longer collide; Hub identity is unchanged.
- Owner-only `lervo_node_fleet_registry` v1 binds project and repository identity, canonical root, node, destination, runtime version, service identity, and health path. Exact-key validation excludes credentials; writes are bounded, locked, atomic, and conflict preserving.
- The registry supplies complete configured membership to distributed event-writer activation without becoming capability or approval evidence. Exact service/config hashes and separately verified Node and Hub observations prevent stale registry bytes from authorizing a writer.
- Fixtures prove folder-independent deterministic identity, distinct registrations and targets for two repositories, refresh without identity drift, duplicate-coordinate rejection, permission bounds, and absence of credential fields.
- `lervo repository node plan` revalidates manifest identity and compares registry and per-instance service coordinates without writing. It reports legacy transition, scoped credential issuance, activation, and readiness as separate authority or observation gaps.
- Planning fixtures cover first onboarding, unchanged desired state, stale coordinates, a legacy singleton, and two repositories on one device. Plans exclude credentials and service bodies, declare exact staleness triggers, and never claim readiness.
- Exact apply ships and materializes a self-contained `lervo-node` runtime and hard-coded Node launcher, installs or transactionally upgrades the canonical service, requires three stable manager and three complete same-process health observations, and commits fleet registration last. Failed installs compensate; failed upgrades restore the exact prior definition.
- Status separates service, event sync, workstream replication, remote control, freshness, project identity, and recovery action. Relocation refreshes mutable root coordinates while preserving manifest-derived instance identity.
- Immutable historical terminal observations remain valid under additive coordinate revisions. Shiflo's `local_batch_invalid` was repaired without changing or dropping any event.
- Installed Shiflo acceptance upgraded the Hub through its verified standalone distribution, migrated the scoped Node credential, activated `com.lervo.node.2bbef9a417cbc00263593a8d`, observed all runtime components ready, and only then stopped and archived the legacy singleton.
- Installed two-repository acceptance activated `com.lervo.node.28de5803e2db5aec8bd4ee7d` for Lervo alongside Shiflo. Both services remained independently active with distinct health files and concurrently reported event sync and workstream replication ready. Lervo explicitly reported remote control disabled.
- Contract and installed-artifact tests cover clean installation, transactional upgrade and rollback, relocation, restart after offline retention, two repositories, two authorized nodes, and divergent heads.

## Acceptance

- Initializing a Hub-enabled repository produces a ready repository Node without a bookkeeping or replication command.
- Shiflo and a second repository run simultaneously on the same Mac with distinct service identities and health records.
- A workstream revision in either repository automatically publishes; a fresh authorized node imports the unique newer head and exposes it to a new Codex or Claude session.
- Device restart, Lervo upgrade, or checkout relocation preserves or safely reconciles repository identity and restores replication automatically.
- A malformed local batch, registration mismatch, unavailable Hub, or divergent head is visible and bounded. Retain local state and never falsely claim synchronization success.
- Installed-runtime evidence records exact versions, observations, Hub coordinates, and replication results without secrets.
- A busy supervised cycle refuses upgrade before any service-manager stop; an idle upgrade preserves and releases the owner fence. For independent conversation turns, prove application shutdown waits for admitted work, the manager atomically stops new admission and refuses an active turn before any stop command, and an idle installed upgrade succeeds without duplicate or lost work. Process-local shutdown tracking alone does not satisfy this gate.
- Prove the first installed Node transition from the legacy, non-participating runtime without treating missing admission rows as idle. Preserve ongoing work and test active and inactive service states, rollback, restart, and configuration binding. Source-level SQLite exclusion alone does not satisfy this installed gate.
- For an organization-bound Discord channel addition, prove an exact shared-channel-only candidate, canonical deployment and channel rebind while the Node is stopped under the work freeze, restoration of both bindings on activation failure, replacement preflight, and delivery of a fresh human message by the intended bot. Configuration bytes and service-manager status alone do not satisfy this gate.
- For a supervised CLI binding refresh, prove the protected transition accepts only the intended deliberation and `managedExecution.cliBundle` references, holds the work freeze through verified stop and activation, and restores the exact predecessor config and admission digest on failure.
- As a bounded structural follow-up, extract service-management argument and source validation from the long lifecycle transaction module while preserving typed failures. Verify the systemd/launchd management suite and bundled CLI entrypoint after extraction. Keep this separate from the safety-critical first-transition change.

## Acceptance evidence and limits

- [ADR-0201](../../../decisions/coordination/sync/0201-repository-scoped-workstream-replication.md) is the accepted replication contract.
- Runtime tests prove automatic publication and import between authorized repository nodes.
- The owner-only registry contains Shiflo and Lervo under distinct instance and service identities.
- Two stable post-install observations showed both native services running without restart and both health snapshots advancing with event sync and workstream replication ready.
- Shiflo remote control remained ready; Lervo's absent remote-command configuration remained explicitly disabled.
- The old `com.lervo.node` target and manager entry were absent after the new Shiflo instance reached readiness. Its prior definition remains archived as recovery evidence.

These observations establish the fleet foundation. The [idle-runtime follow-up](idle-runtime.md) separately tracks ADR-0397 deployed acceptance and ADR-0399 local installed-artifact acceptance. Foundation completion does not establish deployment of those later changes.
