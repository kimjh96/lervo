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

Direct provider terminals use a narrower native-hook path. Each prompt performs a fail-closed query and receives exact-hash context. Stop checks knowledge currency and may observe exact context-reference markers. New markers are standalone Markdown HTML comments; legacy plain v1 tokens remain accepted. Privacy-bounded preparation, reference, and turn events prove neither provider acceptance nor internal use and cannot satisfy managed E1–E4 because Lervo did not create or fully observe the provider process.

## Major boundaries

### Project and storage

`.lervo/project.yaml` identifies the repository and privacy defaults. Durable records are under gitignored `.lervo/data`; rebuildable projections are under `.lervo/state`. Runtime directories are lazy. Legacy relocation is atomic and fails closed on conflicting copies.

Active continuation is `.lervo/state/workstreams/current.json`. CAS under `.lervo/data/cas` stores exact snapshots and optional legacy-source bytes; `workstream.snapshot.recorded` binds revision and content coordinates without event prose. Migration discovers candidates from bounded content structure, not required names or locations. Before context is returned, a missing projection is rebuilt from the latest event and CAS bytes. Canonical Markdown retains long-term facts.

Lazy workforce state is under `.lervo/data/workforce/`. Six built-in role templates and tracked `.lervo/roles/<role-id>.json` sources resolve to versioned deterministic contracts. Composition conservatively merges capabilities and binds exact ancestry hashes. Root agents and subagents share the contract; parentage changes only bounded delegation depth. Atomic scheduler leases reject overlapping paths while allowing disjoint same-role or mixed-role work. Handoffs use exact artifact and context-evidence coordinates, not conversation memory. Managed runs revalidate assignment, agent, lease, write path, provider, role version and hash, and verification suites.

Local capability packages are lazy immutable project- or user-scoped directories. A provider-neutral resolver validates hashes, compatibility, role permissions, exact dependency graphs, discovery metadata, MCP runtime descriptors, and native plugin manifests, then writes a rebuildable lock. Telemetry distinguishes recommendation, selection, verified loading, provider activation, skill invocation, and completion. Agent records bind exact package coordinates; subagents inherit and may narrow them. After controlled injection, adapters translate requests into native configuration and confirm MCP connection or plugin load before the task turn.

Decisions: [project initialization](../decisions/foundation/0002-safe-project-initialization.md), [local event store and CAS](../decisions/operations/storage/0003-local-event-store-and-cas.md), [storage bootstrap](../decisions/operations/storage/0004-project-storage-bootstrap.md).

### Managed execution

Before completion, orchestration resolves role, policy, skills, capability packages, context, provider adapter, write authorization, and verification. Adapters isolate provider behavior and normalize native telemetry. Activation confirmation occurs once after E3 and before the write bridge or task turn; failure closes the session without an activation-success event.

`@lervo/context-coverage` projects managed coverage once from canonical events. Enhanced E3 binds injected receipts to exact document versions. Validated adapter results retain only their digest and turn coordinates; exact returned tokens may create E4 output citations. Evidence-bearing sources and human publication have separate coordinates: only current-envelope evidence metadata is removed before publication evaluation and storage. Local and Hub projections use the same projector and never equate delivery or citation with understanding or internal use.

Terminal integration merges approved handlers into Codex and Claude repository hook configuration without replacing or translating provider-specific settings. Disabled, malformed, or conflicting configuration blocks migration. Stable opaque coordinates bind native prompt and Stop events without raw provider IDs or conversation text.

Managed runs require a present, verified workstream delivered with E1–E3 like any exact-byte source. Direct hooks prepare at most 8 KiB and retain only ID, revision, hash, scope, and byte count. Stop compares prompt-time and final repository revisions. Read-only turns create no history. Changed turns require the working agent to create or advance a bounded checkpoint and declare canonicalization, knowledge, and optional deliberation dispositions at the exact final revision.

Decisions: [context preparation](../decisions/execution/orchestration/0006-deterministic-context-preparation.md), [context delivery](../decisions/execution/providers/0007-provider-neutral-context-delivery.md), [managed context gate](../decisions/execution/orchestration/0008-managed-context-gate-orchestration.md), [Codex adapter](../decisions/execution/providers/0009-codex-app-server-managed-adapter.md), [Claude adapter](../decisions/execution/providers/0010-claude-agent-sdk-managed-adapter.md), [run lifecycle](../decisions/execution/providers/0011-managed-provider-run-lifecycle.md), [terminal integration](../decisions/execution/providers/0196-fail-closed-provider-terminal-integration.md), [unmanaged observation](../decisions/execution/providers/0197-unmanaged-terminal-context-observation.md), [managed grounding](../decisions/execution/providers/0198-managed-context-grounding-and-coverage.md), [natural-language finalization](../decisions/execution/providers/0200-natural-language-terminal-turn-finalization.md), [provider-confirmed capability activation](../decisions/execution/providers/0211-provider-confirmed-capability-activation.md), [isolated agent workspaces](../decisions/execution/orchestration/0222-isolated-agent-workspace-lifecycle.md).

### Repository knowledge

A bounded scanner discovers sources without folder assumptions. Adapters extract stable file, section, key, symbol, revision, verification, event, and skill-contract units. A deterministic structural compiler creates a bounded knowledge map and sidecars. Isolated, capability-free Codex or Claude compilers may create source-cited semantic or normalization candidates.

Human documentation remains under `docs/`, including `docs/knowledge`; `.lervo` stores policy, provenance, manifests, and rebuildable state. `.lervo/knowledge/document-layout.yaml` routes decisions, documents, and canonical instructions; unknown or tied classifications fail closed. Provider-neutral behavior belongs in `docs/instructions/<route>`, portable Agent Skills in `.agents/skills`, and machine registries use deterministic two-hex fan-out with legacy flat-path reads. `foundation` is never an implicit fallback.

Normalization creates bounded English Markdown for an audience profile with complete source-section coverage. Every source requires exact approval. Content-bound shard caches and a three-process ceiling keep runs bounded and resumable without weakening compiler-build or source binding. Planning revalidates inner bindings and the complete current source set. Lifecycle sidecars bind output hashes, format and language versions, compiler build, and skill-resource hashes. Changed documents or skills become stale without automatic rewriting.

```text
repository sources
  -> typed inventory + stable source units
  -> structural plan -----------------> bounded publication + sidecars
  -> isolated semantic compiler
  -> reconcile -> human review ------> claims, relations, semantic pages
  -> lint / impact / query / context delivery
```

Markdown and repository state are canonical; graphs, lexical indexes, and embeddings are rebuildable. Generated indexes use a reduced structural snapshot excluding runtime evidence, revision metadata, verification results, and local-only agent surfaces. Full query snapshots may differ without implying staleness; the current migration plan and manifest determine currency. Tracked policy selects language (`en` in v1), entry bounds, and byte bounds. Large categories become short page trees; obsolete recorded pages are safely deleted.

Decisions: [knowledge compilation](../decisions/knowledge/repository/0170-evidence-bound-repository-knowledge-compilation.md), [OKF exchange](../decisions/knowledge/repository/0171-content-addressed-okf-exchange-and-git-reproduction.md), [agent surface inventory](../decisions/knowledge/repository/0189-typed-repository-agent-surface-inventory.md), [bounded publication](../decisions/knowledge/repository/0190-language-aware-bounded-repository-publication.md), [decision taxonomy](../decisions/knowledge/repository/0192-repository-scoped-decision-taxonomy.md), [document normalization](../decisions/knowledge/repository/0195-reviewed-document-content-normalization.md).

### Document ownership

Each document has one write model:

- `user`: register and read bytes; never rewrite automatically.
- `managed_blocks`: replace only an exact marked block after content-bound approval.
- `lervo_generated`: refresh only when prior generation proves ownership.

README is a byte-preserved, normalization-independent public entrypoint by default. Optional improvement is a separate audience-and-intent-bound proposal with individual protected-coordinate dispositions. AGENTS is the provider-neutral agent entrypoint with a bounded managed route block for canonical instructions and skills. CLAUDE imports AGENTS through a managed bridge while retaining its user region. Provider settings remain provider-specific; migration adds only approved Lervo hooks and preserves all other semantics.

Decisions: [sharded documents](../decisions/knowledge/documents/0017-sharded-document-manifests.md), [existing document adoption](../decisions/knowledge/documents/0018-existing-document-adoption.md), [CommonMark blocks](../decisions/knowledge/documents/0021-commonmark-managed-block-parser.md), [instruction bridges](../decisions/knowledge/repository/0185-profiled-provider-instruction-bridge.md).

### Search and context

Search recommends but does not prove use. Selection records why an item was chosen; loading validates current bytes; delivery creates an adapter receipt before `injected` evidence exists. Later reference or use requires separate provider telemetry.

Decisions: [lexical search](../decisions/search/0053-deterministic-lexical-search-observations.md), [recommendation boundary](../decisions/search/0054-search-recommendation-managed-context-boundary.md), [engine selection](../decisions/search/0060-policy-bound-search-engine-selection.md).

### Hub and node runtimes

Hub endpoints authenticate before project access. Remote commands are signed, time-bound, replay-protected, and bound to a target node and project. Before managed execution, a node revalidates its repository manifest, local policy, approval, and current snapshot. The protocol supports direct TLS, private overlays, loopback proxies, or another authenticated network and is not tied to Tailscale.

Bounded workstream revisions replicate separately from event streams, keyed by project and repository identity. Authorized nodes see the same append-only head set. Each event-producing node uses a distinct destination coordinate because each destination owns one canonical hash chain. A node publishes local ancestry, imports only a newer unique head through CAS, projection, and a system event, and exposes divergence without choosing a winner. Pending approvals transfer only as unresolved state, never authority.

Installed Node services are independently addressable per repository-node identity. Their deterministic instance ID derives from project ID, repository identity hash, and node ID, never the checkout name. An owner-only local fleet registry binds identity to canonical root, destination, runtime version, manager service identity, and per-repository health path without credentials. Read-only onboarding revalidates the manifest, compares registry and content-hashed service-file coordinates, and separates local-state, service, legacy-transition, external-registration, and runtime-observation authority. Exact apply installs or transactionally upgrades the shipped runtime, requires three stable manager observations and complete component observations, then commits the registry. Fleet status reports every project and recovery action independently.

Local event producers do not know Hub endpoints or device credentials. When policy permits and a Node selects a destination, it authenticates registration, checks the Hub cursor against local truth, and durably reconciles the next bounded event prefix into that destination's outbox.

The optional Hub capability registry accepts only explicit content-bound publication. Project packages require matching project scope; public packages require explicit public selection. Separate read and publish permissions protect immutable envelopes. Local packages and execution do not depend on this registry.

Decisions: [signed commands](../decisions/coordination/remote-control/0041-signed-scoped-remote-command.md), [Hub runtime](../decisions/coordination/remote-control/0149-owner-only-loopback-hub-runtime.md), [destination reconciliation](../decisions/coordination/sync/0194-destination-bound-local-event-reconciliation.md), [node control](../decisions/coordination/remote-control/0152-fail-closed-node-remote-control-runtime.md), [managed provider node host](../decisions/execution/providers/0153-managed-provider-node-host.md), [direct TLS](../decisions/coordination/remote-control/0158-direct-tls-hub-runtime.md), [workstream replication](../decisions/coordination/sync/0201-repository-scoped-workstream-replication.md), [fleet identity](../decisions/operations/services/0202-repository-node-fleet-identity-and-registry.md), [onboarding](../decisions/operations/services/0203-read-only-repository-node-onboarding-reconciliation.md), [apply and readiness](../decisions/operations/services/0207-transactional-repository-node-apply-and-readiness.md), [repository upgrade](../decisions/operations/services/0214-bounded-repository-upgrade-orchestration.md).

## Data ownership

| Data | Canonical owner | Sync default |
| --- | --- | --- |
| Repository files and tracked Lervo policy | Git repository | User-controlled |
| Local event chain and CAS | Project node | Off |
| Generated knowledge indexes | Rebuildable from tracked sources | Git-capable |
| Credentials and mutable observations | Local runtime | Never as source docs |
| Repository Node fleet registry | User-local deployment state | Never; contains no credentials |
| Hub read models and command queue | Hub | Explicitly authorized |
| Capability packages and derived lock | Project or user local storage | Off; explicit Hub publish only |

## Failure posture

- Invalid contracts fail closed.
- Uncertain external effects are not automatically retried as if nothing happened.
- Event failure before commit rolls back a managed write.
- Failure after a committed event preserves exact output and requires recovery.
- Missing telemetry lowers assurance and never upgrades a claim.

## Package direction

Contracts and schemas do not depend on provider adapters or applications. Domain packages depend on contracts; storage and provider packages implement ports; applications compose them. `scripts/check-package-boundaries.mjs` enforces this graph.

## Detailed references

- [Execution and evidence specification](../specifications/execution.md)
- [Repository knowledge specification](../specs/repository-knowledge-compilation.md)
- [Architecture decisions](../decisions/)
