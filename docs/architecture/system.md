# Lervo System Architecture

Status: `active`
As of: 2026-08-26

## System shape

```text
user or platform
  -> Lervo CLI / conversation boundary
  -> policy and capability evaluation
  -> context selection and exact delivery receipt
  -> managed provider adapter (Codex or Claude)
  -> repository change and verification
  -> local event store + CAS
  -> optional outbox -> Hub -> other authorized nodes
```

The local project is the execution authority. The Hub coordinates but cannot weaken project policy or replace repository source truth.

Direct provider terminals use a narrower native-hook path. Every prompt performs a fail-closed query and receives exact-hash context. Stop checks knowledge currency and may observe exact context-reference markers. New markers are standalone Markdown HTML comments; legacy plain v1 tokens remain accepted. Privacy-bounded preparation, reference, and turn events prove neither provider acceptance nor internal use and cannot satisfy managed E1–E4 because Lervo did not create or fully observe the provider process.

## Major boundaries

### Project and storage

`.lervo/project.yaml` identifies the repository and privacy defaults. Durable records reside in gitignored `.lervo/data`; rebuildable projections reside in `.lervo/state`. Runtime directories are created lazily. Legacy relocation is atomic and fails closed on conflicting copies.

The optional `.lervo/data/event-contract.json` is the versioned, Lervo-managed future-write
coordinate. Its absence selects event schema version 1. `@lervo/project` validates and
recovers the coordinate before project storage injects the selection into the event-store
adapter; indexes, graphs, and projections cannot change writer authority.

Active continuation is `.lervo/state/workstreams/current.json`. CAS in `.lervo/data/cas` stores exact snapshots and optional legacy-source bytes. `workstream.snapshot.recorded` binds revision and content coordinates without event prose. Migration discovers candidates from bounded content structure, not required names or locations. Before returning context, Lervo rebuilds a missing projection from the latest event and CAS bytes. Canonical Markdown retains long-term facts.

Owner-only workforce and workspace coordination state resides under the Git common directory so sibling worktrees share one scheduler; non-Git checkouts use a standalone compatibility home. Legacy migration rejects competing non-empty authorities. Versioned role contracts, ancestry hashes, bounded delegation, atomic path leases, and exact handoff evidence govern root agents and subagents.

Workspace lifecycle is local; Orca and Hub are optional. Apply rechecks authority, and uncertainty requires recovery. See the [workspace specification](../specifications/execution/agent-workspaces.md).

Local capability packages are lazy, immutable project- or user-scoped directories. A provider-neutral resolver validates hashes, compatibility, role permissions, exact dependency graphs, discovery metadata, MCP runtime descriptors, and native plugin manifests, then writes a rebuildable lock. Telemetry distinguishes recommendation, selection, verified loading, provider activation, skill invocation, and completion. Agent records bind exact package coordinates; subagents inherit and may narrow them. After controlled injection, adapters translate requests into native configuration and confirm MCP connection or plugin load before the task turn.

Decisions: [project initialization](../decisions/foundation/0002-safe-project-initialization.md), [local event store and CAS](../decisions/operations/storage/0003-local-event-store-and-cas.md), and [storage bootstrap](../decisions/operations/storage/0004-project-storage-bootstrap.md).

### Managed execution

Before effects, the provider grounds requests into validated typed decisions. Orchestration then resolves role, policy, skills, capabilities, context, write authorization, and verification. Adapters normalize native telemetry. Activation is confirmed once after E3 and before the write bridge or task turn; failure closes the session without an activation-success event.

`@lervo/context-coverage` projects managed coverage once from canonical events. Enhanced E3 binds injected receipts to exact document versions. Validated adapter results retain only their digest and turn coordinates; exact returned tokens may create E4 output citations. Evidence-bearing sources and human publication have separate coordinates: only current-envelope evidence metadata is removed before publication evaluation and storage. Local and Hub projections use the same projector and never equate delivery or citation with understanding or internal use.

Terminal integration merges approved handlers into Codex and Claude hook configuration without replacing provider settings. Invalid or conflicting configuration blocks migration. Opaque coordinates bind prompt and Stop events without raw provider IDs or conversation text. An exact managed worktree binds one writer and generation without claiming managed-provider telemetry.

Managed runs require a verified workstream delivered with E1–E3. After reader-first writer activation, each managed admission records one provider-neutral causal event before `run.requested`; version-1 writers and invalid ancestry block provider startup. Deliberation uses one control root and explicit child relationships. Work IDs aggregate evidence but grant no objective, assignment, or completion authority. Direct hooks prepare at most 8 KiB and retain bounded coordinates. Unattached and integrator Stop require global checkpoints for changed revisions. Worker Stop validates its workspace, writer, lease, and scoped diff and records a private checkpoint; foreign global movement is informational.

The headless application boundary rebuilds current assignment, causal-attempt, resource, and
next-action reports. `@lervo/application-contract` owns public shapes;
`@lervo/work-controller` owns pure projections; applications compose existing effects without
bypassing lease, approval, verification, event, or recovery authority. Token admission thresholds
are exact to provider and accounting descriptor. Unlike groups stay separate, and observed usage
is neither a reservation nor a billing cap.

See [interactions](../specifications/execution/assignment-interactions.md),
[routines](../specifications/execution/assignment-routines.md), and
[connectors](../specifications/execution/assignment-connectors.md).

Decisions: [context preparation](../decisions/execution/orchestration/0006-deterministic-context-preparation.md), [context delivery](../decisions/execution/providers/0007-provider-neutral-context-delivery.md), [managed context gate](../decisions/execution/orchestration/0008-managed-context-gate-orchestration.md), [Codex adapter](../decisions/execution/providers/0009-codex-app-server-managed-adapter.md), [Claude adapter](../decisions/execution/providers/0010-claude-agent-sdk-managed-adapter.md), [run lifecycle](../decisions/execution/providers/0011-managed-provider-run-lifecycle.md), [terminal integration](../decisions/execution/providers/0196-fail-closed-provider-terminal-integration.md), [unmanaged observation](../decisions/execution/providers/0197-unmanaged-terminal-context-observation.md), [managed grounding](../decisions/execution/providers/0198-managed-context-grounding-and-coverage.md), [natural-language finalization](../decisions/execution/providers/0200-natural-language-terminal-turn-finalization.md), [provider-confirmed capability activation](../decisions/execution/providers/0211-provider-confirmed-capability-activation.md), [isolated agent workspaces](../decisions/execution/orchestration/0222-isolated-agent-workspace-lifecycle.md), and [headless governed loops](../decisions/execution/orchestration/0336-adopt-headless-governed-loop-and-assignment-graph.md).

### Repository knowledge

A bounded scanner, typed source adapters, and deterministic structural compiler project repository evidence without assuming folder names. Isolated capability-free providers may propose source-cited semantic or normalization candidates, while reviewed Markdown and semantic records remain canonical.

```text
repository sources
  -> typed inventory + stable source units
  -> structural plan -----------------> bounded publication + sidecars
  -> isolated semantic compiler
  -> reconcile -> human review ------> claims, relations, semantic pages
  -> lint / impact / query / context delivery
```

Detailed source, projection, normalization, routing, and failure boundaries are in [Repository knowledge and document ownership](repository-knowledge.md).

### Document ownership

Every document has one write model: user-owned bytes, exact managed blocks, or proven Lervo-generated output. Provider entrypoints retain user regions; AGENTS carries only a fixed-size registry bootstrap, and CLAUDE imports it through a managed bridge. The detailed ownership and migration contract is in [Repository knowledge and document ownership](repository-knowledge.md#document-ownership).

### Search and context

Search recommends but does not prove use. The product-qualified Lexical v2 engine and projected retrieval plan are the no-transition product defaults. Lexical v1 remains the independent local and release-rollback baseline. Repository-specific engines use the compatibility engine-selection chain; different composed local or external retrieval uses a separate content-bound complete-plan selection above the same provider-neutral ports. Explicit local selections retain reviewed activation, current runtime validation, and fail-closed stage behavior. Ordinary managed runs do not add linked-only context after search.

See [Search and context boundaries](search-and-context.md) for engine ownership, extension steps, evidence states, and failure behavior.

### Hub and node runtimes

Hub endpoints authenticate before access. Signed organization policies enforce project scopes and separate credential issuance from delivery. Secret-free grants bind their Node, destination, permissions, generation, and lifetime; runtime sources provide bearer bytes. The owner-only file source performs bounded no-follow reads, clears raw buffers, and activates a candidate only after authenticated project registration. It is not an external secret authority.

Approved rollout execution and rollback are exact one-Node transactions. Forward delivery authenticates, fences replay, and records a recovery baseline; recovery classifies without applying. Rollback binds the failed artifact to the enrolled predecessor and commits the registry after readiness. It lacks authenticated process delivery. None is Hub, daemon, or multi-Node transport.

Bounded workstream revisions replicate separately from event streams, keyed by project and repository identity. Authorized nodes see the same append-only head set. Each event-producing node uses a distinct destination coordinate because each destination owns one canonical hash chain. A node publishes local ancestry, imports only a newer unique head through CAS, projection, and a system event, and exposes divergence without choosing a winner. Pending approvals transfer only as unresolved state, never authority.

Installed Nodes use deterministic project, repository, and Node identity. An owner-only local registry binds root, destination, runtime, service, and health coordinates without credentials. Exact apply transactionally installs or upgrades, requires three stable complete observations, then registers. Organization enrollment binds that evidence to active credential delivery. Rollout begins with one canary, grows at most twofold, and separates planning, observation, approval, execution, and rollback. Plans and approvals claim no effect; a Node execution receipt claims only its exact local transaction.

Local event producers do not know Hub endpoints or device credentials. When policy permits and a Node selects a destination, it authenticates registration, checks the Hub cursor against local truth, and durably reconciles the next bounded event prefix into that destination's outbox.

Event-reader compatibility is a provider-neutral, rebuildable capability observation,
not writer authority. Local diagnostics and Node health advertise their readable
envelope versions; Hub exposes the same secret-free report through an identity-bound
health endpoint that sync clients read without sending bearer credentials. Missing or
incapable peers cannot authorize v2 writing, while local execution and v1 writing remain
independent of Hub availability. For a Hub-enabled project, the existing owner-only Node
fleet registry is the complete configured membership authority; the service definition
and runtime config bind its Node and Hub observation sources. Planning and apply each
re-observe exact capability and identity, without creating another reader registry.

Optional Hub coordination reserves path digests before local leases. Summaries are observational; the Hub cannot write, integrate, approve, or clean. See [Hub and Node coordination](../specifications/coordination/hub-and-node.md).

The optional Hub capability registry accepts only explicit content-bound publication. Project packages require matching project scope; public packages require explicit public selection. Separate read and publish permissions protect immutable envelopes. Local packages and execution do not depend on this registry.

Decisions: [signed commands](../decisions/coordination/remote-control/0041-signed-scoped-remote-command.md), [Hub runtime](../decisions/coordination/remote-control/0149-owner-only-loopback-hub-runtime.md), [destination reconciliation](../decisions/coordination/sync/0194-destination-bound-local-event-reconciliation.md), [node control](../decisions/coordination/remote-control/0152-fail-closed-node-remote-control-runtime.md), [direct TLS](../decisions/coordination/remote-control/0158-direct-tls-hub-runtime.md), [workstream replication](../decisions/coordination/sync/0201-repository-scoped-workstream-replication.md), [fleet identity](../decisions/operations/services/0202-repository-node-fleet-identity-and-registry.md), [distributed reader inventory](../decisions/operations/trace/0332-authoritative-distributed-event-reader-inventory.md), [apply](../decisions/operations/services/0207-transactional-repository-node-apply-and-readiness.md), [organization rollout](../decisions/operations/security/0229-organization-node-enrollment-and-gradual-rollout.md), [owner-only credential source](../decisions/operations/security/0230-owner-only-file-organization-credential-source.md), [authenticated Node credential activation](../decisions/operations/security/0231-authenticated-node-organization-credential-activation.md), [approved Node rollout transaction](../decisions/operations/security/0232-approved-node-rollout-local-transaction.md), [authenticated rollout delivery](../decisions/operations/security/0233-authenticated-node-rollout-process-delivery.md), [bounded rollout recovery](../decisions/operations/security/0234-bounded-node-rollout-effect-recovery.md), [predecessor-bound rollback](../decisions/operations/security/0235-predecessor-bound-node-rollout-rollback.md), and [upgrade](../decisions/operations/services/0214-bounded-repository-upgrade-orchestration.md).

## Data ownership and failure

Canonical ownership, sync defaults, and fail-closed recovery rules are defined in [Data ownership and failure boundaries](data-ownership-and-failure.md).

## Package direction

Contracts and schemas do not depend on provider adapters or applications. Domain packages depend on contracts; storage and provider packages implement ports; applications compose them. `scripts/check-package-boundaries.mjs` enforces this graph.

The application contract remains a contract package, not an application
implementation. The work controller may depend on provider-neutral contracts and
workforce snapshots; it cannot import CLI, storage adapters, or provider adapters.
Product applications depend inward on that boundary.

## Detailed references

- [Execution and evidence specification](../specifications/execution.md)
- [Repository knowledge specification](../specs/repository-knowledge-compilation.md)
- [Architecture decisions](../decisions/)
