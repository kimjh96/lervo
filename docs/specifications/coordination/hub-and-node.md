# Hub and Node coordination specification

Status: `active`
As of: 2026-08-24

## Authentication and authority

Hub operations authenticate before access and are scoped to registered project coordinates. Transport grants no execution authority. Remote commands bind signature, signer purpose, node, project, time bounds, nonce, idempotency, capability, and content-addressed artifacts. Before execution, a Node revalidates trust, registration, manifest, local policy, approval, snapshot, freshness, and replay.

## Event streams

One destination plus project coordinate owns one canonical event hash chain. Each event-producing Node therefore uses a distinct destination coordinate. After registration, sync compares the Hub cursor with exact local history, queues a bounded prefix into that destination's durable outbox, and fails on mismatch. Local producers neither read Hub credentials nor wait for Node delivery.

## Repository workstreams

Workstream revisions are shared by project plus repository identity across authorized destination registrations. Requests bind registration, repository identity, exact current and previous snapshot hashes, and bounded snapshot bytes. Node publishes available local ancestry before reading the head set.

The Hub retains at most 16 append-only heads and returns exact snapshot bytes only for a unique head. Divergence is observable and never automatically selected or merged. Node imports only a newer unique head through CAS, the lazy projection, and a system `workstream.snapshot.recorded` event with change kind `hub_replication_import`.

Replication requires separate `workstream.read` and `workstream.write` permissions. It excludes legacy source bodies, prompts, transcripts, credentials, signatures, and approval grants. Pending approval descriptions remain unresolved state and confer no authority.

## Runtime lifecycle

Node reports event sync, workstream replication, and remote control as separate health components. Workstream divergence reports `divergent_heads`; retryable transport or validation failures report unavailable without discarding local state.

Service installation requires a canonical definition and write authority. New Hub or Node activation must remain installed, enabled where applicable, and active across three observations 500 milliseconds apart. Removal allows six observations and requires three consecutive stopped observations before deleting the definition. Stabilization proves OS continuity only; identity-bound Hub or live-process Node preflight proves readiness separately.

## References

- [Execution and evidence specification](../execution.md)
- [Repository-scoped workstream replication](../../decisions/coordination/sync/0201-repository-scoped-workstream-replication.md)
- [Destination-bound event reconciliation](../../decisions/coordination/sync/0194-destination-bound-local-event-reconciliation.md)
- [Node remote control](../../decisions/coordination/remote-control/0152-fail-closed-node-remote-control-runtime.md)
