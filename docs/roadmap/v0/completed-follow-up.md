# Completed v0 follow-up

The [v0 roadmap](../v0.md#completed-follow-up) links each topic's roadmap, decision, and evidence. Completion preserves the unresolved gates and authority boundaries below.

## Grounding and retrieval

- Managed context grounding and coverage: per-document E1–E4 evidence; every selection ground; separate delivery, reference, and relevance coverage; explicit managed and unmanaged boundaries without claiming understanding.
- Local hybrid search and reviewed relation context: registered deterministic keyword-plus-sparse-embedding candidates; top-50 and reviewed top-10 contracts; a reproducible 20-case quality and latency observation. Optimized build and warm-query costs passed, but quality gates remain unresolved and activation undetermined. Activation requires measured need. Snapshot-bound, sidecar-bound one-hop graph recommendations and registered-document-only E1 selection use ordinary E2/E3 delivery.
- Claim-eligible linked supporting context: completed the default-off canary, typed claim-authority boundary, and fresh 8+8 activation population. A lexical-only control found no quality uplift, so ADR-0302 retired the ordinary default while preserving historical evidence.

## Terminal flow, workforce, and deployment

- Natural-language terminal development flow: user-command-free changed-turn finalization, current unresolved decisions and approvals, selectively requested managed Codex-Claude deliberation, Shiflo acceptance, and cross-node acceptance.
- Repository onboarding and agent workforce: automatic safe onboarding; six versioned built-ins including researcher; repository-defined specialization and conservative composition; durable agents; conflict-safe same-role and mixed-role concurrency; identical subagent lifecycle; natural-language dispatch; leases; evidence-bound handoff.
- Repository Node fleet and automatic Hub replication: repository-scoped service identity, transactional apply and upgrade, complete readiness, historical-event compatibility, legacy transition, and installed two-repository acceptance.
- Repository upgrade orchestration: one exact plan for capability migration, bounded generated-knowledge convergence, lint, terminal-runtime refresh, and content-addressed registered-Node replacement without inheriting user, provider, credential, or publication authority.
- Managed provider terminal-hook isolation: managed Codex and Claude sessions suppress provider-native project hooks, preventing recursive unmanaged terminal preparation and finalization during deliberation and ordinary managed runs.
- Isolated agent workspace lifecycle completed.

## Capability lifecycle

- Local-first capability package supply chain: project/user packages for skills, MCP servers, provider plugins, and bundles; exact dependency locks; agent/subagent inheritance; plan-bound installation; optional authorized Hub project/public sharing without automatic upload.
- Provider-confirmed capability activation: hashed provider-neutral MCP runtime descriptors, native plugin validation, Codex and Claude session translation, exact activation receipts and events, fail-closed pre-turn confirmation, runtime-only credentials, and shared root-agent/subagent semantics.
- Natural-language capability lifecycle: verified discovery metadata, deterministic recommendation, separate recommendation/selection/load/activation evidence, exact skill-instruction invocation, safe loose-skill migration, and structured Hub publication.

## Knowledge and state

- Public README migration: byte-preserving public entrypoints, separate audience-aware improvement, protected public coordinates, and exact approval without exposing internal agent bookkeeping.
- Deletable derived state boundary: durable `.lervo/data`, resettable `.lervo/state`, automatic legacy relocation, compact current knowledge projections, superseded-snapshot pruning, and event-plus-CAS workstream reconstruction.
- Content-bound provider-entrypoint bootstrap: Claude-only repositories adopt exact existing instructions into canonical AGENTS before independently converging a byte-proven duplicate or preserving mixed provider content around one managed bridge.
- Typed derived-state retention and bounded pruning: typed protected and reclaimable state, path-private exact plans, journaled apply and recovery, durable result evidence, and a higher selective-prune bound; unattended cleanup remains disabled.
- Evidence-bound development-pattern promotion: provider-neutral repeated-evidence candidates, immutable review provenance, responsibility-routed exact promotion, rebuildable status, and a Codex/Claude dogfood pattern without automatic fact promotion.

## Conventions and release

- Repository commit convention: Conventional Commits 1.0.0, package-derived optional scopes, local validation, and pull-request/main-push enforcement.
- Repository code convention: separation of concerns and responsibilities, bounded module growth, exact-content structural review for long production modules, explicit dependency direction, present-need abstraction, testable effects, ESLint quality rules, deterministic Prettier formatting, disposable caches, local commands, and pull-request/main-push enforcement.
- Supported-runtime release portability: runtime-independent built-in classification, narrowly scoped Node 22 SQLite warning compatibility, offline cross-volume Windows deployment, and minimum-runtime packed-consumer verification.
- Reviewed CLI release preparation: exact CLI release intent, pre-1.0 policy, deterministic version-and-bounded-note reconciliation, generated-file ownership, annotated-tag handoff, and separate publication authority.
