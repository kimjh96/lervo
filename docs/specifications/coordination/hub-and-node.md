# Hub and Node coordination specification

Status: `active`
As of: 2026-08-24

## Authentication and authority

Hub operations authenticate before access and are scoped to registered project coordinates. Transport grants no execution authority. Remote commands bind the signature, signer purpose, Node, project, time bounds, nonce, idempotency, capability, and content-addressed artifacts. Before execution, a Node revalidates trust, registration, manifest, local policy, approval, snapshot, freshness, and replay.

## Event streams

One destination and project coordinate owns one canonical event hash chain, so each event-producing Node uses a distinct destination coordinate. After registration, synchronization compares the Hub cursor with exact local history, queues a bounded prefix in that destination's durable outbox, and fails on mismatch. Local producers neither read Hub credentials nor wait for Node delivery.

## Repository workstreams

Workstream revisions are shared by project and repository identity across authorized destination registrations. Requests bind registration, repository identity, exact current and previous snapshot hashes, and bounded snapshot bytes. Node publishes available local ancestry before reading the head set.

The Hub retains at most 16 append-only heads and returns exact snapshot bytes only for a unique head. Divergence is observable and is never automatically selected or merged. Node imports only a newer unique head through CAS, the lazy projection, and a system `workstream.snapshot.recorded` event with change kind `hub_replication_import`.

Replication requires separate `workstream.read` and `workstream.write` permissions. It excludes legacy source bodies, prompts, transcripts, credentials, signatures, and approval grants. Pending approval descriptions remain unresolved state and confer no authority.

## Capability packages

Hub capability publication is an optional distribution surface, not a prerequisite for local execution. Project publications require an authorized destination and project coordinate; public publications remain explicitly selected. `capability.publish` and `capability.read` are separate bearer permissions.

Immutable envelopes bind the validated package content hash, scope, publisher principal, and publication time. Every record also carries a verified structured header: `capability_package`, package kind, manifest schema version, file count, total bytes, and `secretMaterial: excluded`. Filesystem storage uses deterministic two-hex ID sharding.

Documents use shared-context publication coordinates and CAS bytes; repository knowledge uses versioned OKF bundles. These content classes remain distinct and independently validated. Same-content retries are idempotent; different content at one ID and version conflicts. Hub storage and responses exclude bearer values and MCP credential values.

## Runtime lifecycle

Node reports event synchronization, workstream replication, and remote control as separate health components. Workstream divergence reports `divergent_heads`; retryable transport or validation failures report unavailable without discarding local state.

Service installation requires a canonical definition and write authority. New Hub or Node activation must remain installed, enabled where applicable, and active across three observations 500 milliseconds apart. Removal allows six observations and requires three consecutive stopped observations before deleting the definition. Stabilization proves only OS continuity; identity-bound Hub or live-process Node preflight proves readiness separately.

Repository upgrade may reconcile an already registered Node by recovering the config coordinate from its exact owner-only canonical service definition. Plans expose only a config-path digest. Desired deployment identity is the SHA-256 of the shipped Node payload and its content-addressed launcher, not the semantic version alone. Missing configuration, an unsafe service target, a legacy singleton, or degraded-but-uncertain runtime state remains explicit pending or blocked work.

An exact active deployment remains upgrade-current when its only unavailable component code is `hub_unavailable`; this does not make fleet health ready. During registered replacement, a bounded sixty-second window may produce `offline_ready` after three fresh monotonic observations from one new process only when every non-ready required component has that exact retryable code. First onboarding and every authentication, configuration, integrity, divergence, stale, mixed, or unknown failure still require complete readiness or fail closed.

## References

- [Execution and evidence specification](../execution.md)
- [Repository-scoped workstream replication](../../decisions/coordination/sync/0201-repository-scoped-workstream-replication.md)
- [Destination-bound event reconciliation](../../decisions/coordination/sync/0194-destination-bound-local-event-reconciliation.md)
- [Node remote control](../../decisions/coordination/remote-control/0152-fail-closed-node-remote-control-runtime.md)
- [Local-first capability package supply chain](../../decisions/execution/orchestration/0210-local-first-capability-package-supply-chain.md)
