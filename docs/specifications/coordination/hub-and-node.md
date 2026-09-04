# Hub and Node coordination specification

Status: `active`
As of: 2026-08-26

## Authentication and authority

Hub operations require authentication and registered project coordinates. Transport grants no execution authority. Remote-command signatures bind signer purpose, Node, project, time bounds, nonce, idempotency, capability, and content-addressed artifacts. Before execution, a Node revalidates trust, registration, manifest, local policy, approval, snapshot, freshness, and replay.

Organization deployment policy is a separate signed, content-addressed boundary. V1 requires strict project tenancy and explicit per-project principals. Credential issuance and runtime delivery use different principals; rotation and revocation have separate permissions. Policy bounds runtime permissions, lifetime, and overlap. Missing policy authority denies the organization operation but never disables local-only execution.

Credential grants bind policy hash, repository identity, Node, destination, subject, permissions, generation, and validity, but contain neither material nor a source location. An injected source supplies bounded bearer bytes only after authority, time, and revocation checks; an injected consumer confirms activation. Source bytes are cleared on every post-load exit. Delivery receipts contain `secretMaterial: excluded` and prove neither authentication nor later use. See [ADR-0228](../../decisions/operations/security/0228-organization-deployment-policy-and-runtime-credentials.md).

The owner-only file bootstrap adapter binds exact credential IDs to runtime-private paths in an immutable in-memory snapshot. It uses bounded, no-follow, owner-only reads, clears its raw buffer, and exposes only the returned byte array to the delivery contract. It does not issue credentials, persist bindings, activate or reload a Node, select an external secret authority, or add source coordinates to organization records. See [ADR-0230](../../decisions/operations/security/0230-owner-only-file-organization-credential-source.md).

An installed Node may opt into organization delivery with one explicit organization Node ID. The application binds each grant to that ID, the loaded repository identity, and its Hub destination before reading the existing owner-only bearer file. It verifies the candidate through the authenticated project-registration exchange before replacing the running token. Failure preserves the prior in-memory token and creates no receipt. Credential mutations are exclusive. This proves neither every permission nor synchronization, readiness, later use, durable file rollback, or rollout. See [ADR-0231](../../decisions/operations/security/0231-authenticated-node-organization-credential-activation.md).

## Organization fleet rollout

Organization enrollment binds an active delivered credential to the deterministic repository service instance, runtime artifact, local onboarding plan and apply receipt hashes, and three complete online readiness observations. It excludes paths, service bodies, credential sources, and secret material. `offline_ready` is sufficient only for a bounded registered replacement in the local lifecycle; it cannot establish first organization admission.

A rollout names every enrolled target exactly once. A multi-Node rollout begins with one canary; each wave grows by at most twofold, contains at most 32 Nodes, and permits zero unavailable Nodes. Advancement requires the exact target version and artifact, event synchronization, workstream replication, and three consecutive complete readiness observations. Pending evidence holds. Degraded, unavailable, stale, version-mismatched, or artifact-mismatched evidence requires an explicit rollback decision.

Planning, observation, approval, execution, and rollback remain separate. The planner cannot approve its plan, and the approver cannot execute the approved action. First-wave execution requires explicit approval. Later execution binds the exact prior ready observation; rollback binds the exact current failed observation. Plans, observations, and approvals claim no service effect.

One Node-scoped execution plan may bind an approved `execute_wave` member to its exact current local plan ID and hash, target executable artifact, repository identity, destination, and executor. Apply revalidates every organization and local binding before invoking the existing local Node transaction. Its secret-free receipt proves only that Node's complete online apply; wave observation still controls advancement.

An installed CLI receiver accepts the complete forward plan only through a bounded owner-only signed request and scoped Ed25519 trust manifest. It re-derives project identity, requires the delivery signer principal to equal the recorded approver, recalculates the local plan, and durably reserves delivery hash, idempotency key, nonce, and a path-free recovery baseline before apply. A completed duplicate returns the same stored receipt. An interrupted or unpersisted effect remains `in_progress` and is never rerun automatically. The recovery command compares the baseline with an exact current replan, persists `applied`, `not_applied`, or `unknown`, and never synthesizes an execution receipt.

A separate one-Node rollback plan binds an exact failed target observation to the distinct predecessor version and artifact recorded by enrollment. Its installed adapter verifies both executable artifacts, the failed service definition, registry state, and current predecessor plan before invoking the explicit local service rollback action. Complete online readiness precedes predecessor registry commit, and pre-commit failure attempts exact forward compensation. The low-level adapter grants no signed delivery or replay authority; the installed receiver described below adds those controls but grants no unattended delivery. Neither boundary is a Hub endpoint, Node daemon transport, or multi-Node transaction. See [ADR-0229](../../decisions/operations/security/0229-organization-node-enrollment-and-gradual-rollout.md), [ADR-0232](../../decisions/operations/security/0232-approved-node-rollout-local-transaction.md), [ADR-0233](../../decisions/operations/security/0233-authenticated-node-rollout-process-delivery.md), [ADR-0234](../../decisions/operations/security/0234-bounded-node-rollout-effect-recovery.md), and [ADR-0235](../../decisions/operations/security/0235-predecessor-bound-node-rollout-rollback.md).

The installed three-Node acceptance composes these Node-scoped boundaries through a one-Node canary and two-Node expansion. Only a complete canonical wave observation permits advancement; pending evidence holds, and an exact degraded target permits explicit rollback of that Node alone. This verifies orchestration boundaries, not live-machine operation, unattended automation, or cross-Node atomicity. See [the acceptance evidence](../../evidence/operations/organization-node-multi-device-rollout-v1.md).

An installed rollback receiver accepts a distinct signed rollback envelope through owner-only request and trust files. It revalidates the exact predecessor plan, reserves a rollback-specific SQLite replay coordinate before mutation, returns completed duplicates, and leaves uncertain effects fenced. Recovery inspects exact predecessor disposition and persists `rolled_back`, `not_rolled_back`, or `unknown` without invoking rollback. This remains a one-Node local process boundary rather than a Hub endpoint, daemon transport, automatic selector, or multi-Node transaction. See [ADR-0236](../../decisions/operations/security/0236-authenticated-node-rollback-process-delivery.md).

## Event streams

Each destination and project coordinate owns one canonical event hash chain, so every event-producing Node uses a distinct destination coordinate. After registration, synchronization compares the Hub cursor with exact local history, queues a bounded prefix in that destination's durable outbox, and fails on mismatch. Local producers neither read Hub credentials nor wait for Node delivery.

Reader compatibility is advertised separately from registration and writer selection. The local trace surface, owner-only Node health snapshot, and Hub `GET /v1/health/capabilities` return the same `EventReaderCapabilitiesV1` meaning. The sync transport authenticates the Hub identity before trusting its body and does not send the bearer secret to this unauthenticated endpoint. The report contains only its schema, the fixed `event_reader` capability name, and ascending readable event-schema versions. It grants no write or rollout authority. A missing, invalid, unverified, or v2-incapable peer report blocks future v2 writer activation but does not disable local execution or current v1 synchronization.

For Hub-enabled writer activation, the owner-only repository Node fleet registry is the configured membership authority. Its one project registration binds the installed service and owner-only runtime config, which identify the Node health file and one Hub destination. Node health additively binds event-reader capability to project, repository identity, and destination. Planning and apply each require an exact current three-reader set: local runtime, registered Node, and configured Hub. Activation evidence contains source and peer hashes but excludes paths, URLs, service bodies, bearer paths or bytes, and credentials. See [ADR-0332](../../decisions/operations/trace/0332-authoritative-distributed-event-reader-inventory.md).

## Repository workstreams

Workstream revisions are shared by project and repository identity across authorized destination registrations. Requests bind registration, repository identity, exact current and previous snapshot hashes, and bounded snapshot bytes. Node publishes available local ancestry before reading the head set.

The Hub retains at most 16 append-only heads and returns exact snapshot bytes only for a unique head. Divergence is observable and never automatically selected or merged. Node imports only a newer unique head through CAS, the lazy projection, and a system `workstream.snapshot.recorded` event with change kind `hub_replication_import`.

Replication requires separate `workstream.read` and `workstream.write` permissions. It excludes legacy source bodies, prompts, transcripts, credentials, signatures, and approval grants. Pending approval descriptions remain unresolved state and confer no authority.

## Agent workspace coordination

Agent workspace coordination is a separate optional Hub surface. Local execution defaults to `local_first` and uses the repository-instance scheduler without Hub access. A repository may explicitly select `hub_coordinated` for assignments spanning multiple Nodes; connectivity never changes the mode implicitly.

Before a local claim in coordinated mode, a Node requests a reservation binding project and repository identity, normalized path-scope digests, assignment and workspace IDs, Node ID, generation, base commit, integration-target digest, bounded expiry, and idempotency. Exact and ancestor scopes conflict. The Node acquires its local lease only after obtaining the reservation and releases the reservation if the local claim fails. Renewal fences stale generations.

Separate `workspace.read` and `workspace.coordinate` permissions govern this surface. Hub storage and audit exclude local paths, branch names, source or patch bodies, prompts, provider output, credentials, approval grants, and cleanup commands. A reservation is scheduler evidence only; it grants no repository write, merge, provider, approval, deployment, or cleanup authority.

Reservation loss before claim blocks startup. Expiry after claim freezes new managed writes and automatic integration while preserving the local worktree for higher-generation recovery. Hub unavailability has no execution effect in `local_first`. Only the Node may integrate or remove a worktree, and only through exact local plans.

V1 reservations inherit local workforce bounds: at most 128 normalized scopes and leases from 5 seconds through 30 minutes. A Hub reservation cannot expire after its local lease. Immutable policy `workspace-coordination-v1` permits 32 active reservations and 128 current terminal summaries per destination/project/repository coordinate; terminal summaries expire after 30 days. Reaching a limit rejects new coordination and never evicts an active reservation.

Hub current state is `pending`, `granted`, `released`, or `expired`; only `granted` is claimable. Every committed state change has one append-only audit transition. Workspace summaries accept only monotonic generations and lifecycle transitions and remain observational. Out-of-order, unknown-parent, or invalid transitions fail closed. Assignment evaluation distinguishes `disabled`, `ready`, `unavailable`, `conflicted`, and `stale_generation`. Node runtime reconciliation independently reports `disabled`, `pending`, `ready`, or `unavailable` with a bounded failure code.

The Node derives summaries from canonical repository-instance lifecycle events, reads the authenticated Hub current set, skips exact or newer remote observations, and publishes missing transitions in local event order. A missing provisioning parent, stale generation, altered content hash, unverified Hub identity, or transport failure stops reconciliation without changing local lifecycle state. Summaries are observational projections; only local events remain repository authority.

Workspace reservations and repository workstream replication retain distinct identities, permissions, and failure meanings. Reservation order cannot select a divergent workstream head; workstream head selection cannot override a scope conflict. See the planned [agent workspace specification](../execution/agent-workspaces.md).

## Capability packages

Hub capability publication is an optional distribution surface, not a prerequisite for local execution. Project publications require an authorized destination and project coordinate; public publications remain explicitly selected. `capability.publish` and `capability.read` are separate bearer permissions.

Immutable envelopes bind validated package content hash, scope, publisher principal, and publication time. Each record also has a verified structured header containing `capability_package`, package kind, manifest schema version, file count, total bytes, and `secretMaterial: excluded`. Filesystem storage uses deterministic two-hex ID sharding.

Documents use shared-context publication coordinates and CAS bytes; repository knowledge uses versioned OKF bundles. These content classes remain distinct and independently validated. Same-content retries are idempotent; different content at one ID and version conflicts. Hub storage and responses exclude bearer values and MCP credential values.

## Runtime lifecycle

Node reports event synchronization, workstream replication, and remote control as separate health components. Workstream divergence reports `divergent_heads`; retryable transport or validation failures report unavailable without discarding local state.

Service installation requires a canonical definition and write authority. New Hub or Node activation must remain installed, enabled where applicable, and active across three observations 500 milliseconds apart. Removal permits six observations and requires three consecutive stopped observations before deleting the definition. Stabilization proves only OS continuity; identity-bound Hub or live-process Node preflight proves readiness separately.

Repository upgrade may reconcile an already registered Node by recovering the config coordinate from its exact owner-only canonical service definition. Plans expose only a config-path digest. Desired deployment identity is the SHA-256 of the shipped Node payload and its content-addressed launcher, not the semantic version alone. Missing configuration, an unsafe service target, a legacy singleton, or degraded-but-uncertain runtime state remains explicit pending or blocked work.

An exact active deployment remains upgrade-current when its only unavailable component code is `hub_unavailable`; this does not make fleet health ready. During registered replacement, a bounded sixty-second window may produce `offline_ready` after three fresh monotonic observations from one new process only when every non-ready required component has that exact retryable code. First onboarding and every authentication, configuration, integrity, divergence, stale, mixed, or unknown failure still require complete readiness or fail closed.

## References

- [Execution and evidence specification](../execution.md)
- [Repository-scoped workstream replication](../../decisions/coordination/sync/0201-repository-scoped-workstream-replication.md)
- [Destination-bound event reconciliation](../../decisions/coordination/sync/0194-destination-bound-local-event-reconciliation.md)
- [Node remote control](../../decisions/coordination/remote-control/0152-fail-closed-node-remote-control-runtime.md)
- [Local-first capability package supply chain](../../decisions/execution/orchestration/0210-local-first-capability-package-supply-chain.md)
- [Isolated agent workspace lifecycle](../../decisions/execution/orchestration/0222-isolated-agent-workspace-lifecycle.md)
