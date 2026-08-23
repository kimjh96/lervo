# ADR-0170: Evidence-Bound Repository Knowledge Compilation and Migration

- Status: accepted
- Decision date: 2026-08-22

## Context

Earlier document migration assumed existing documents or a supplied root and could not discover concepts, decisions, invariants, procedures, and ownership from code, configuration, schemas, tests, and Git. `AGENTS.md` and `CLAUDE.md` are knowledge-to-execution bridges, not arbitrary document exceptions. Comparative research found no single OKF, LLMWiki, GraphRAG, SCIP/Tree-sitter, repository-map, provenance, supply-chain, validation, catalog, or architecture system that alone satisfies Lervo's local-first ownership and evidence requirements.

## Decision

Migration is evidence-bound, repository-wide knowledge compilation under the normative repository-knowledge-compilation specification. The pipeline performs repository inventory, stable source-unit extraction, unprivileged managed compilation, candidate reconciliation, ownership-aware materialization, lint, and incremental refresh. Documents are one source type and need not be under `docs/`.

Human-reviewed Markdown and sidecars are publication truth. Code, configuration, schemas, tests, Git, verification, and execution events are evidence truth. Extracted concepts, claims, and relations are candidates. AST/SCIP, semantic graphs, search, embeddings, and task maps are rebuildable projections.

The native model separates bundles, concepts, atomic claims, source units, and typed relations. Claims bind stable ID, statement digest, source-unit version, assurance, and freshness. Assurance is `unreviewed`, `machine_reviewed`, `human_reviewed`, or `verified`; generation or valid citation alone never establishes `verified`.

The compiler reads only prepared source envelopes and has no filesystem-write, shell, network, messaging, deploy, or tool capability. Repository and instruction content is `untrusted_source_data`. Provider bootstrap may use authenticated inference, but model sessions receive no filesystem, shell, MCP, browser, or external-action tools. Host-observed Codex input/events and Claude invocation/terminal metadata support zero-use evidence; provider self-report does not. Candidate bodies remain immutable local unreviewed state rather than events.

Apply uses one explicit plan ID and, by default, changes only new Lervo-owned publications and sidecars. `--accept-all-safe` never authorizes disposition of user bytes. The only implemented user-byte mutation is content replacement inside an explicit Lervo v1 repository-knowledge managed block, requiring per-item disposition approval and an exact full-output hash. Markers and every byte outside the block remain identical. Whole-document patch, move, split, merge, delete, instruction changes, and contradiction resolution are unimplemented or require separate approval. Existing useful documents remain in place and link as sources and concepts. A new bundle defaults to `docs/knowledge/` only when unambiguous.

Different concept outputs targeting the same block are skip-only conflicts. Repository-origin semantic review uses tracked reviewer policy and immutable CAS decisions, not deliberation-origin review events. `knowledge.reconciliation.reviewed` records only IDs, hashes, decisions, and approval-list digest. `register_existing` normally leaves user Markdown unchanged and creates claim sidecars; approved managed-block patches share the transaction. `create_generated` creates Lervo-owned publications. Outcomes are `human_reviewed` unless separately verified.

Semantic apply prepares complete owner-only journal and staged bytes, syncs them, then atomically promotes a fixed materialization transaction marker. Each before/after hash is bound. Pre-event interruption requires explicit rollback. Recorded or committed state verifies after-bytes and removes only the marker. Scan, plan, query, and apply fail closed while a marker exists. This provides durable replay, not filesystem-wide atomicity.

Materialization preserves stable `unitId` alongside content-bound `unitVersionId`. Refresh, query, and lint recompute `current`, `stale`, or `unknown` against the current scan and bounded historical projection. Changed, missing, and unavailable lineage remain distinct. Content-addressed impact reports contain no body or path and never delete publication automatically. Derived refresh-review candidates remain separate, review-required, and non-mutating.

Managed-provider knowledge query remains separate from document search. Selected knowledge publications become current-hash document candidates binding concept, assurance, freshness, snapshot, and impact coordinates through E0/E1/E2, a neutral envelope, and E3. Byte changes after E1 block E2. Search never becomes used evidence.

OKF v0.2 is an import/export format, not native storage. Sidecars project to front matter and claim footnotes while preserving unknown metadata and never forcing front matter into user documents. Git-tracked Markdown and sidecars are the primary cross-device sharing mechanism; Hub is optional transport and indexing.

## Consequences

Knowledge covers the entire repository while document tooling remains available as ingestion and materialization primitives. Source provenance, review level, refresh impact, and agent context share one contract. Completion requires migrating Lervo itself through the command and producing acceptance evidence; manual pre-moves do not qualify.
