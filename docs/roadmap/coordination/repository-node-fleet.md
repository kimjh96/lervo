# Repository Node fleet and automatic Hub replication

Status: `planned`
As of: 2026-08-25

## Problem

Workstream replication is automatic inside a running, authorized Node runtime, but the installed service lifecycle does not yet guarantee it for every initialized repository. The current macOS service is a global `com.lervo.node` instance configured only for Shiflo. Roven has no deployed Node instance; the installed Shiflo service is crash-looping with exit code 1; and a diagnostic run reported `local_batch_invalid` for event sync and workstream replication.

Contract and runtime tests prove the implementation, not the installed repository fleet's health. Ordinary Lervo onboarding must not require users to install, start, repair, or manually trigger Hub replication.

## Product outcome

Every Hub-enabled repository has one durable repository-node registration and one independently addressable runtime instance. Lervo automatically reconciles the desired fleet during initialization, migration, upgrade, repository relocation, and health recovery. Workstream revisions publish, and newer unique Hub heads import, without a user command. Local execution remains available when the Hub is unavailable.

Repository identity comes from the project manifest and identity hash, never the checkout folder name. Multiple repositories on one device run concurrently without sharing service labels, configuration, event destinations, credentials, health, or repair state.

## Required work

1. Replace the global singleton service identity with a stable per-repository instance identity derived from safe project and node coordinates.
2. Maintain a local fleet registry binding project ID, repository identity hash, repository root, node ID, destination ID, runtime version, service identity, and health path without bearer-token bytes.
3. Make onboarding plan and reconcile Hub registration, scoped credentials, a repository Node instance, native service activation, and three-observation readiness. Only credential issuance, external registration, or other authority boundaries may require user approval.
4. Reconcile repository moves by manifest identity and an explicitly verified new physical root; folder names do not define identity.
5. Upgrade runtime payloads and service definitions transactionally. Preserve the last working version until its replacement reaches readiness, and recover crash loops without silently weakening validation.
6. Diagnose and repair Shiflo's `startup_failed` and `local_batch_invalid` conditions without discarding, rewriting, or pretending to synchronize local event history.
7. Register and activate Roven independently of Shiflo, then prove both services remain active and synchronize concurrently on the same Mac.
8. Report event sync, workstream replication, and remote control separately for every repository. Aggregate fleet status must name the affected project and recovery action.
9. Keep workstream publication and import automatic, ancestry ordered, idempotent, privacy bounded, and fail closed on divergence. Never copy approval authority, transcripts, credentials, or provider reasoning.
10. Add clean-install, upgrade, relocation, restart, offline recovery, two-repository, two-node, and divergent-head acceptance scenarios using installed artifacts, not only in-process fixtures.

## Acceptance

- Initializing a Hub-enabled repository produces a ready repository Node without a user bookkeeping or replication command.
- Shiflo and Roven run simultaneously on the same Mac under distinct service identities and health records.
- Creating a workstream revision in either repository automatically publishes it to the Hub; a fresh authorized node imports the unique newer head and exposes it to a new Codex or Claude session.
- Device restart, Lervo upgrade, or checkout relocation preserves or safely reconciles repository identity and restores replication automatically.
- A malformed local batch, registration mismatch, unavailable Hub, or divergent head is visible and bounded. Local state is retained, and no successful synchronization is claimed.
- Installed-runtime evidence records exact versions, observations, Hub coordinates, and replication results without secret values.

## Current evidence

- The accepted replication contract is [ADR-0201](../../decisions/coordination/sync/0201-repository-scoped-workstream-replication.md).
- The runtime test suite proves automatic publication and import between authorized repository nodes.
- On 2026-08-25, the installed `com.lervo.node` service targeted `/Users/jonghyeok/orca/shiflo`, had no active process, and reported last exit code 1.
- Roven's active workstream was revision 6, but no Roven Node deployment was present, so Hub publication was not established.
- Briefly running the current Node runtime against the Shiflo configuration started successfully but recorded `local_batch_invalid`; this is diagnostic evidence, not successful replication.
