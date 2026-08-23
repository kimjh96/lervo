# ADR-0170: Evidence-Bound Repository Knowledge Compilation and Migration

- Status: accepted
- Decision date: 2026-08-22

## Context

Earlier document migration assumed existing documents or a supplied root. It could not discover concepts, decisions, invariants, procedures, and ownership from code, configuration, schemas, tests, and Git. AGENTS.md and CLAUDE.md are knowledge-to-execution bridges, not arbitrary document exceptions. Comparative research found no single OKF, LLMWiki, GraphRAG, SCIP/Tree-sitter, repository-map, provenance, supply-chain, validation, catalog, or architecture system satisfying Lervo's local-first ownership and evidence requirements alone.

## Decision

Migration means evidence-bound repository knowledge compilation under the normative repository-knowledge-compilation specification. The pipeline is repository-wide inventory, stable source-unit extraction, unprivileged managed compilation, candidate reconciliation, ownership-aware materialization, lint, and incremental refresh. Documents are one source kind and need not live under docs/.

Human-reviewed Markdown and sidecars are publication truth. Code, config, schema, tests, Git, verification, and execution events are evidence truth. Extracted concepts/claims/relations are candidates; AST/SCIP, semantic graphs, search, embeddings, and task maps are rebuildable projections.

The native model separates bundles, concepts, atomic claims, source units, and typed relations. Claims bind stable ID, statement digest, source-unit version, assurance, and freshness. Assurance is unreviewed, machine_reviewed, human_reviewed, or verified; generation or valid citation alone never yields verified.

The compiler reads only prepared source envelopes and receives no filesystem write, shell, network, messaging, deploy, or tool capability. Repository and instruction content is untrusted_source_data. Provider bootstrap may use authenticated inference, but model sessions receive no filesystem, shell, MCP, browser, or external-action tools. Host-observed Codex input/events and Claude invocation/terminal metadata support zero-use evidence; provider self-report does not. Candidate bodies stay immutable local unreviewed state, not events.

Apply under one explicit plan ID changes only new Lervo-owned publications/sidecars by default. --accept-all-safe never authorizes user-byte disposition. The only implemented user-byte mutation is content replacement inside an explicit Lervo v1 repository-knowledge managed block, requiring per-item disposition approval and exact full-output hash. Markers and all bytes outside that block remain identical. Whole-document patch/move/split/merge/delete, instruction changes, and contradiction resolution remain unimplemented or separately approved. Existing useful documents stay in place and link as sources/concepts. A new bundle defaults to `docs/knowledge/` only when unambiguous.

Multiple different concept outputs targeting one block become skip-only conflicts. Repository-origin semantic review uses tracked reviewer policy and immutable CAS decisions, not deliberation-origin review events. knowledge.reconciliation.reviewed records only IDs/hashes/decisions and approval-list digest. register_existing normally leaves user Markdown unchanged and creates claim sidecars; approved managed-block patches share the transaction. create_generated makes Lervo-owned publications. Outcomes are human_reviewed unless separately verified.

Semantic apply prepares a complete owner-only journal and staged bytes, syncs them, then atomically promotes a fixed materialization transaction marker. It binds each before/after hash. Pre-event interruption requires explicit rollback; recorded/committed state verifies after bytes and cleans only the marker. While a marker exists, scan/plan/query/apply fail closed. This is durable replay, not filesystem-wide atomicity.

Materialization preserves stable unitId beside content-bound unitVersionId. Refresh/query/lint recompute current, stale, or unknown against current scan plus bounded historical projection. Changed, missing, and unavailable lineage remain distinct. Content-addressed impact reports contain no body/path and never auto-delete publication. Derived refresh-review candidates remain separate, review-required, and non-mutating.

Managed-provider knowledge query remains distinct from document search. Selected knowledge publications become current-hash document candidates binding concept, assurance, freshness, snapshot, and impact coordinates through E0/E1/E2, neutral envelope, and E3. Byte changes after E1 block E2. Search never becomes used evidence.

OKF v0.2 is import/export, not native storage. Sidecars project to front matter/claim footnotes while preserving unknown metadata and never forcing front matter into user documents. Git-tracked Markdown/sidecars are primary cross-device sharing; Hub is optional transport/index.

## Consequences

Knowledge scope is the whole repository, with document tooling retained as ingestion/materialization primitives. Source provenance, review level, refresh impact, and agent context now share one contract. Completion requires migrating Lervo itself through the command and producing acceptance evidence; manual pre-moves do not satisfy it.
