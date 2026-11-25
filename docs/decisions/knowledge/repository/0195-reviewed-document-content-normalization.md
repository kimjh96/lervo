# ADR-0195: Reviewed document content normalization

- Status: accepted
- Decision date: 2026-08-24
- Performance amendment: 2026-08-25
- Amended by: [ADR-0457](../documents/0457-degrade-knowledge-intake-per-file-and-consolidate-documents.md), [ADR-0473](../documents/0473-publish-knowledge-within-its-write-scope-and-never-rewrite-a-tool-generated-document.md)

## Context

ADR-0193 normalized paths and provider surfaces while preserving source bytes. Relocation, structural navigation, and semantic concepts do not repair inconsistent structure, language, audience, duplicated concerns, oversized documents, or skill resources detached from their lifecycle.

Migration must establish the documentation system, protect user-owned bytes, and prevent untrusted prose from acquiring provider capabilities.

## Decision

### Migration and provider contract

Repository migration has four ordered stages:

1. Deterministic inventory, routing, provider-surface normalization, and structural publication.
2. Isolated provider content normalization.
3. Exact per-source review and durable apply.
4. Structural refresh, lint, and a current replan.

`lervo migrate knowledge --provider codex|claude` runs normalization after earlier stages are current. `lervo knowledge normalize` exposes the same stage. Provider selection changes only the adapter; both enforce a no-filesystem, no-shell, no-network, no-tool contract. Candidates remain in ignored local state so apply uses reviewed output without rerunning a nondeterministic model.

The normalizer receives bounded documents, explicit v1 English publication language, a format profile, and stable source-section versions. It returns one result per source, one retained entrypoint, optional grouped topic files where splitting is allowed, and complete source-section coverage. Providers use short document-local integer indexes that Lervo validates and resolves to content-bound source-unit version IDs. A single-output rewrite binds every section to that output; only splits require section assignment.

### Output profiles and validation

Every output requires an H1 and must meet byte and line limits.

- README serves people and routes agents to AGENTS. The root README cannot split into a root-level `README/` tree; durable detail belongs in the semantic documentation hierarchy.
- Reviewed topics in a sibling `README/` family inherit the package or subsystem entrypoint's local placement. Later layout passes preserve that bounded family rather than reclassifying topics as unrelated legacy documentation.
- AGENTS and canonical instruction pages serve agents.
- CLAUDE is a thin bridge limited to 2 KiB and 40 lines.
- Decisions retain decision anatomy.
- Agent Skills retain portable identity, triggers, workflow, constraints, resources, and verification.
- The root handoff remains a short continuation entrypoint; independent history and subsystem details move under `docs/repository/handoffs/`. ADR-0199 supersedes this clause as described below.

Validation rejects missing sections, changed skill names, and dropped instruction frontmatter, lifecycle metadata, managed blocks, provider imports, fenced examples, or link coordinates in skills or agent instructions. It also rejects inline coordinates in portable skill material, unsafe paths, oversized outputs, duplicate destinations, capability telemetry, unsupported languages, trailing whitespace, and normalizer-introduced trailing blank lines. Every output ends with exactly one newline. Lifecycle fields such as `Status:` and `As of:` and path-scope frontmatter on canonical instructions remain byte-exact. Portable Skill descriptions may use the publication language; Skill names remain fixed.

General documents and prose instructions may condense inline examples. Exact human review, not byte equality, establishes semantic preservation; structural checks do not prove equivalent meaning. Each approval binds source bytes, output hashes, section coverage, skill-resource hashes, compiler build, language, and format version.

### Batching, retries, and cache

Provider work starts in content-bound batches of at most two documents and 32 KiB of source bytes, with at most three isolated provider processes active concurrently. A source exceeding the batch byte target remains one bounded document rather than being split without a section-preservation contract. If a multi-document call fails or returns an invalid response, Lervo retries its documents sequentially as single-document calls. A single-document failure is terminal for that attempt and is not retried automatically.

Every schema-valid document result is cached immediately in ignored local state, independently of its batch. The `document-v2` cache key binds the compiler descriptor and exact document input: language, format, no-capability control, path, profile, content hash and bytes, source-unit coordinates, protected fragments, and output constraints. It excludes the repository snapshot ID, allowing reuse of an unchanged document after an unrelated repository change. The assembled candidate, each operation, approval, resource binding, and apply plan remain bound to the complete current repository snapshot. Cache reuse grants no cross-snapshot write authority.

The cache record, `.lervo/state/knowledge/normalization-shards/<shard>/knormcache_<id>.json`, contains the schema version, `document-v2` contract name, cache ID, compiler descriptor, document-input hash, and validated response. It may contain normalized document bodies and therefore remains owner-only ignored local state; events and tracked publications retain only hashes and counts. Missing, malformed, oversized, compiler-stale, or contract-stale cache data is a miss and never establishes candidate validity. Provider or validation failure emits no success event. Completed document records survive a later sibling failure, so interrupted work resumes with only missing documents.

Shard start, cache reuse, split retry, and completion are transient progress only. They expose ordinal and document counts, never paths, bodies, prompts, hashes, or provider output. Progress uses stderr in human and JSON modes, leaving one final machine-readable JSON object on stdout.

### Review, apply, and lifecycle

Loading and apply revalidate safe unique destinations, profile bounds, output hashes, complete coverage, operation and approval bindings, and the current repository's entire eligible-source and skill-resource set. Recomputing an outer candidate ID cannot conceal altered inner invariants.

Apply uses the durable knowledge journal to write user documents and lifecycle records together. Deterministic lint runs before the event. During this stage only, `instruction_bridge_binding_stale` is an explicit transition warning because reviewed AGENTS or CLAUDE changes invalidate the prior bridge binding; every other lint error rolls back. Immediate bridge and structural refresh must restore ordinary lint validity.

Emit `knowledge.materialization.applied` with `operation=normalize_documents`. Events contain only compiler identity, hashes, counts, coverage, and validation coordinates—never bodies, paths, prompts, or provider output.

Lifecycle records live in the sharded `.lervo/knowledge/document-normalizations` registry. Each independently binds exact outputs, user-owned regions excluding managed blocks, and included package resources for portable skills. Managed-block refresh does not stale unchanged prose; changed or missing user regions, outputs, or resources do. Applying a replacement deletes older records for the same source within the content-bound transaction. Refresh rebuildable navigation afterward.

### Scope and exclusions

Version 1 rewrites ordinary Markdown and portable Markdown skill material. It does not modify configuration, hooks, executable skill scripts, binary assets, sensitive sources, or provider enforcement settings, though these may remain content-hash dependencies of a skill. A reviewed change to content-bound project skill material atomically refreshes the package's Lervo manifest content hashes as deterministic metadata. Manifest files are excluded from normalization resource bindings; resulting instruction, reference, script, and asset bytes remain bound.

Tracked repository policy may exclude already governed document collections from provider normalization without excluding them from scan, structural compilation, query, or capacity evaluation. These bounded path patterns are part of the policy hash and migration revalidation. They declare repository-owned byte governance, not successful provider normalization, and cannot create normalization lifecycle evidence for excluded sources.

## Consequences

- Migration completion requires current content-normalization records for eligible user Markdown not covered by tracked normalization exclusions; moved legacy bytes are insufficient.
- Existing generated entrypoints are format-owned; existing user entrypoints require reviewed normalization.
- Multi-topic documents may become short entrypoints with grouped sibling topics.
- Interrupted normalization reruns only invalidated or incomplete documents, even when their original batch or repository snapshot changes.
- Skill prose may follow repository language and format, while scripts and assets retain operational meaning and can stale the skill.
- Human approval remains the semantic-equivalence boundary.

## Superseded clauses

This decision supersedes ADR-0193 and the repository knowledge specification only where they treated byte-preserving relocation as complete migration. Exact approval, managed-block ownership, provider-configuration preservation, and the no-capability compiler boundary remain unchanged.

ADR-0199 supersedes the clause retaining root HANDOFF as the active continuation entrypoint. The handoff-document profile remains only for nested durable history.
