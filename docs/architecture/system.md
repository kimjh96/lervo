# Lervo System Architecture

Status: `active`
As of: 2026-08-24

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

`.lervo/project.yaml` identifies the repository and defines privacy defaults. Local events form a validated hash chain; larger content uses content-addressed storage. Runtime directories are created only when their first artifact is written.

Decisions: [project initialization](../decisions/foundation/0002-safe-project-initialization.md), [local event store and CAS](../decisions/operations/storage/0003-local-event-store-and-cas.md), [storage bootstrap](../decisions/operations/storage/0004-project-storage-bootstrap.md).

### Managed execution

Before declaring completion, the orchestrator resolves role, policy, skills, context, provider adapter, write authorization, and verification. Adapters isolate provider behavior and normalize native telemetry into a common contract.

Decisions: [context preparation](../decisions/execution/orchestration/0006-deterministic-context-preparation.md), [context delivery](../decisions/execution/providers/0007-provider-neutral-context-delivery.md), [managed context gate](../decisions/execution/orchestration/0008-managed-context-gate-orchestration.md), [Codex adapter](../decisions/execution/providers/0009-codex-app-server-managed-adapter.md), [Claude adapter](../decisions/execution/providers/0010-claude-agent-sdk-managed-adapter.md), [run lifecycle](../decisions/execution/providers/0011-managed-provider-run-lifecycle.md).

### Repository knowledge

The scanner discovers bounded sources without relying on folder conventions. Adapters extract stable file, section, key, symbol, revision, verification, event, and skill-contract units. A deterministic structural compiler builds a bounded knowledge map and sidecars. Isolated Codex or Claude compilers can create source-cited semantic candidates or reviewed normalization candidates without tools or external capabilities.

Human documentation remains under `docs/`, including generated navigation at `docs/knowledge`. Hidden `.lervo` paths hold policy, provenance, manifests, and rebuildable state. `.lervo/knowledge/document-layout.yaml` routes decisions, documents, and canonical instructions; unknown or tied classifications fail closed. Provider-neutral behavior belongs under `docs/instructions/<route>`, portable Agent Skills under `.agents/skills`, and machine registries use deterministic two-hex fan-out with legacy flat-path read compatibility. `foundation` is never an implicit fallback.

Normalization follows structural routing. Providers return bounded English Markdown for an audience profile with complete source-section coverage. Exact per-source approval preserves semantics. Content-bound shard caches and a three-process concurrency ceiling support bounded, resumable runs without weakening compiler-build or source binding. Planning revalidates stored candidates against inner bindings and the complete current source set. Lifecycle sidecars bind output hashes, format and language versions, compiler build, and skill-resource hashes. Changed documents or skills become stale but are not rewritten automatically.

```text
repository sources
  -> typed inventory + stable source units
  -> structural plan -----------------> bounded publication + sidecars
  -> isolated semantic compiler
  -> reconcile -> human review ------> claims, relations, semantic pages
  -> lint / impact / query / context delivery
```

Markdown and repository state are canonical; graphs, lexical indexes, and embeddings are rebuildable. Tracked policy selects language (`en` in v1), page-entry bounds, and byte bounds. Large categories become short page trees, and obsolete recorded pages are deleted safely.

Decisions: [knowledge compilation](../decisions/knowledge/repository/0170-evidence-bound-repository-knowledge-compilation.md), [OKF exchange](../decisions/knowledge/repository/0171-content-addressed-okf-exchange-and-git-reproduction.md), [agent surface inventory](../decisions/knowledge/repository/0189-typed-repository-agent-surface-inventory.md), [bounded publication](../decisions/knowledge/repository/0190-language-aware-bounded-repository-publication.md), [decision taxonomy](../decisions/knowledge/repository/0192-repository-scoped-decision-taxonomy.md), [document content normalization](../decisions/knowledge/repository/0195-reviewed-document-content-normalization.md).

### Document ownership

Documents use one write model:

- `user`: register and read bytes, but never rewrite automatically.
- `managed_blocks`: replace only an exact marked block after content-bound approval.
- `lervo_generated`: refresh only when prior generation proves ownership.

README is the human entrypoint. AGENTS is the provider-neutral agent entrypoint and contains a bounded managed route block for canonical instructions and skills. CLAUDE imports AGENTS through a managed bridge while retaining its user-authored region. Provider settings remain provider-specific inventory and are never translated into shared policy.

Decisions: [sharded documents](../decisions/knowledge/documents/0017-sharded-document-manifests.md), [existing document adoption](../decisions/knowledge/documents/0018-existing-document-adoption.md), [CommonMark blocks](../decisions/knowledge/documents/0021-commonmark-managed-block-parser.md), [instruction bridges](../decisions/knowledge/repository/0185-profiled-provider-instruction-bridge.md).

### Search and context

Search recommends; it does not prove use. Selection records why an item was chosen. Loading validates current bytes. Delivery creates an adapter receipt before `injected` evidence exists. Later reference or use requires separate provider telemetry.

Decisions: [lexical search](../decisions/search/0053-deterministic-lexical-search-observations.md), [recommendation boundary](../decisions/search/0054-search-recommendation-managed-context-boundary.md), [engine selection](../decisions/search/0060-policy-bound-search-engine-selection.md).

### Hub and node runtimes

Hub endpoints authenticate before project-scoped access. Remote commands are signed, time-bound, replay-protected, and bound to a target node and project. Before managed execution, a node revalidates its repository manifest, local policy, approval, and current snapshot.

The protocol can use direct TLS, private overlays, loopback proxies, or another authenticated network; it is not tied to Tailscale.

Local event producers do not know Hub endpoints or device credentials. If project policy permits sync and a Node selects a destination, the Node authenticates registration, checks the Hub cursor against local truth, and durably reconciles the next bounded event prefix into that destination's outbox. This preserves local-first execution and restartable cross-device evidence propagation.

Decisions: [signed commands](../decisions/coordination/remote-control/0041-signed-scoped-remote-command.md), [Hub runtime](../decisions/coordination/remote-control/0149-owner-only-loopback-hub-runtime.md), [destination reconciliation](../decisions/coordination/sync/0194-destination-bound-local-event-reconciliation.md), [node control](../decisions/coordination/remote-control/0152-fail-closed-node-remote-control-runtime.md), [managed provider node host](../decisions/execution/providers/0153-managed-provider-node-host.md), [direct TLS](../decisions/coordination/remote-control/0158-direct-tls-hub-runtime.md).

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
- Do not automatically retry uncertain external effects as though nothing happened.
- Event failure before commit rolls back a managed write.
- Failure after a committed event preserves exact output and requires recovery.
- Missing telemetry lowers assurance; it never upgrades a claim.

## Package direction

Contracts and schemas do not depend on provider adapters or applications. Domain packages depend on contracts; storage and provider packages implement ports; applications compose them. `scripts/check-package-boundaries.mjs` enforces this graph.

## Detailed references

- [Execution and evidence specification](../specifications/execution.md)
- [Repository knowledge specification](../specs/repository-knowledge-compilation.md)
- [Architecture decisions](../decisions/)
