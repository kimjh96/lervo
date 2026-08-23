# Lervo System Architecture

Status: `active`
As of: 2026-08-23

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

## Major boundaries

### Project and storage

`.lervo/project.yaml` identifies the repository and sets privacy defaults. Local events use a validated hash chain; larger content uses content-addressed storage. Runtime directories are created lazily when their first artifact is written. Initialization creates no dormant feature trees.

Key decisions: [project initialization](../decisions/foundation/0002-safe-project-initialization.md), [local event store and CAS](../decisions/operations/storage/0003-local-event-store-and-cas.md), [storage bootstrap](../decisions/operations/storage/0004-project-storage-bootstrap.md).

### Managed execution

The orchestrator resolves role, policy, skills, context, provider adapter, write authorization, and verification before declaring completion. Provider adapters normalize native telemetry into a common contract and keep provider-specific behavior behind the adapter boundary.

Key decisions: [context preparation](../decisions/execution/orchestration/0006-deterministic-context-preparation.md), [context delivery](../decisions/execution/providers/0007-provider-neutral-context-delivery.md), [managed context gate](../decisions/execution/orchestration/0008-managed-context-gate-orchestration.md), [Codex adapter](../decisions/execution/providers/0009-codex-app-server-managed-adapter.md), [Claude adapter](../decisions/execution/providers/0010-claude-agent-sdk-managed-adapter.md), [run lifecycle](../decisions/execution/providers/0011-managed-provider-run-lifecycle.md).

### Repository knowledge

The scanner discovers bounded repository sources independently of folder convention. Source adapters extract stable file, section, key, symbol, revision, verification, event, and skill-contract units. A deterministic structural compiler creates a bounded knowledge map and sidecars. Optional isolated Codex or Claude compilers can produce source-cited semantic candidates with no tools or external capabilities.

Visible human documentation stays under `docs/`, including generated navigation at `docs/knowledge`. Hidden `.lervo` paths are the control plane: policy, provenance, manifests, and rebuildable state. Repository-scoped routes from `.lervo/knowledge/document-layout.yaml` organize decisions, ordinary documents, and canonical instructions; unknown or tied classifications fail closed. Provider-neutral behavioral rules live under `docs/instructions/<route>`, while portable Agent Skills live under `.agents/skills`. Machine registries use deterministic two-hex fan-out with legacy flat-path read compatibility during migration. `foundation` is never an implicit fallback.

```text
repository sources
  -> typed inventory + stable source units
  -> structural plan -----------------> bounded publication + sidecars
  -> isolated semantic compiler
  -> reconcile -> human review ------> claims, relations, semantic pages
  -> lint / impact / query / context delivery
```

Markdown and repository state are canonical. Graphs, lexical indexes, and embeddings are rebuildable projections. The tracked publication policy selects language (`en` in v1), page-entry bounds, and byte bounds. Large categories shard into short page trees; obsolete recorded pages are deleted safely.

Key decisions: [knowledge compilation](../decisions/knowledge/repository/0170-evidence-bound-repository-knowledge-compilation.md), [OKF exchange](../decisions/knowledge/repository/0171-content-addressed-okf-exchange-and-git-reproduction.md), [agent surface inventory](../decisions/knowledge/repository/0189-typed-repository-agent-surface-inventory.md), [bounded publication](../decisions/knowledge/repository/0190-language-aware-bounded-repository-publication.md), [decision taxonomy](../decisions/knowledge/repository/0192-repository-scoped-decision-taxonomy.md).

### Document ownership

Documents have one of three write models:

- `user`: Lervo reads and registers bytes but does not rewrite them automatically.
- `managed_blocks`: Lervo may replace only an exact marked block after content-bound approval.
- `lervo_generated`: Lervo may refresh bytes only when a previous generation proves ownership.

README is a human entrypoint. AGENTS is the provider-neutral agent entrypoint and contains a bounded managed route block for canonical instructions and skills. CLAUDE imports AGENTS through a managed bridge while preserving its user-authored region. Provider execution settings remain provider-specific inventory and are never translated into shared policy.

Key decisions: [sharded documents](../decisions/knowledge/documents/0017-sharded-document-manifests.md), [existing document adoption](../decisions/knowledge/documents/0018-existing-document-adoption.md), [CommonMark blocks](../decisions/knowledge/documents/0021-commonmark-managed-block-parser.md), [instruction bridges](../decisions/knowledge/repository/0185-profiled-provider-instruction-bridge.md).

### Search and context

Search produces recommendations, not use evidence. Context selection records why an item was selected. Loading validates current bytes. Delivery produces an adapter receipt before `injected` evidence exists. Provider telemetry must separately prove later references or use.

Key decisions: [lexical search](../decisions/search/0053-deterministic-lexical-search-observations.md), [recommendation boundary](../decisions/search/0054-search-recommendation-managed-context-boundary.md), [engine selection](../decisions/search/0060-policy-bound-search-engine-selection.md).

### Hub and node runtimes

Hub endpoints authenticate before project-scoped reads or writes. Remote commands are signed, time-bounded, replay-protected, and tied to a target node and project. A node revalidates its repository manifest, local policy, approval, and current snapshot before invoking a managed provider host.

Transport is not tied to Tailscale. Direct TLS, private overlays, loopback proxies, or another authenticated network may carry the same protocol.

Key decisions: [signed commands](../decisions/coordination/remote-control/0041-signed-scoped-remote-command.md), [Hub runtime](../decisions/coordination/remote-control/0149-owner-only-loopback-hub-runtime.md), [node control](../decisions/coordination/remote-control/0152-fail-closed-node-remote-control-runtime.md), [managed provider node host](../decisions/execution/providers/0153-managed-provider-node-host.md), [direct TLS](../decisions/coordination/remote-control/0158-direct-tls-hub-runtime.md).

## Data ownership

| Data | Canonical owner | Sync default |
|---|---|---|
| Repository files and tracked Lervo policy | Git repository | User-controlled |
| Local event chain and CAS | Project node | Off |
| Generated knowledge indexes | Rebuildable from tracked sources | Git-capable |
| Credentials and mutable observations | Local runtime | Never as source docs |
| Hub read models and command queue | Hub | Explicitly authorized |

## Failure posture

- Invalid contracts fail closed.
- Uncertain external effects are not retried automatically as if nothing happened.
- Event failure before commit rolls back a managed write.
- Failure after a committed event preserves exact output and requires recovery.
- Missing telemetry reduces assurance; it never upgrades a claim.

## Package direction

Contracts and schemas have no dependency on provider adapters or applications. Domain packages depend on contracts. Storage and provider packages implement ports. Applications compose them. `scripts/check-package-boundaries.mjs` enforces the allowed dependency graph.

## Detailed references

- [Execution and evidence specification](../specifications/execution.md)
- [Repository knowledge specification](../specs/repository-knowledge-compilation.md)
- [Architecture decisions](../decisions/)
