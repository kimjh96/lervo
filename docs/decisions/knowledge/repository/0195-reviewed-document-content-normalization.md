# ADR-0195: Reviewed document content normalization

- Status: accepted
- Decision date: 2026-08-24

## Context

ADR-0193 normalized paths and provider surfaces while preserving source bytes. Relocation alone does not resolve inconsistent structure, language, audience, duplicated concerns, oversized documents, or skill resources detached from their lifecycle. Structural navigation and semantic concepts also do not repair source documents.

Migration must establish the documentation system while protecting user-owned bytes and preventing untrusted prose from acquiring provider capabilities.

## Decision

Repository migration has four ordered stages:

1. Deterministic inventory, routing, provider-surface normalization, and structural publication.
2. Isolated provider content normalization.
3. Exact per-source review and durable apply.
4. Structural refresh, lint, and a current replan.

`lervo migrate knowledge --provider codex|claude` runs normalization after earlier stages are current. `lervo knowledge normalize` exposes the same stage. Provider selection changes only the adapter; both enforce a no-filesystem, no-shell, no-network, no-tool contract. Candidates remain in ignored local state so apply uses reviewed output without rerunning a nondeterministic model.

The normalizer receives bounded documents, explicit v1 English publication language, a format profile, and stable source-section versions. It returns one result per source, one retained entrypoint, optional grouped topic files where splitting is allowed, and complete source-section coverage. Providers use short document-local integer indexes that Lervo validates and resolves to content-bound source-unit version IDs. A single-output rewrite binds every section to that output; only splits require section assignment.

Every output requires an H1 and must meet byte and line limits. README serves people and routes agents to AGENTS. The root README cannot split into a root-level `README/` tree; durable detail belongs in the semantic documentation hierarchy. AGENTS and canonical instruction pages serve agents. CLAUDE is a thin bridge limited to 2 KiB and 40 lines. Decisions retain decision anatomy. Agent Skills retain portable identity, triggers, workflow, constraints, resources, and verification. The root handoff remains a short continuation entrypoint; independent history and subsystem details move under `docs/repository/handoffs/`.

Validation rejects missing sections, changed skill names, dropped instruction frontmatter, lifecycle metadata, managed blocks, provider imports, fenced examples, link coordinates in skills or agent instructions, inline coordinates in portable skill material, unsafe paths, oversized outputs, duplicate destinations, capability telemetry, unsupported languages, trailing whitespace, and trailing blank lines introduced by the normalizer. Every output ends with exactly one newline. Lifecycle fields such as `Status:` and `As of:` and path-scope frontmatter on canonical instructions remain byte-exact. Portable Skill descriptions may use the publication language, but Skill names remain fixed.

General documents and prose instructions may condense inline examples. Exact human review, not byte equality, establishes semantic preservation; structural checks do not prove equivalent meaning. Each approval binds source bytes, output hashes, section coverage, skill-resource hashes, compiler build, language, and format version.

Provider work uses content-bound shards with at most three isolated provider processes active concurrently. Each schema-valid response is cached in ignored local state, keyed by compiler build and the complete envelope. Interrupted or rejected work resumes at the first missing shard. Cache reuse cannot cross changes to source, policy, prompt, schema, provider, model, or adapter. Human-readable commands report shard start, completion, and reuse without adding progress to final JSON.

Loading and apply revalidate safe unique destinations, profile bounds, output hashes, complete coverage, operation and approval bindings, and the current repository's entire eligible-source and skill-resource set. Recomputing an outer candidate ID cannot conceal altered inner invariants.

Apply uses the durable knowledge journal to write user documents and lifecycle records together. Deterministic lint runs before the event. During this stage only, `instruction_bridge_binding_stale` is an explicit transition warning because reviewed AGENTS or CLAUDE changes invalidate the prior bridge binding; every other lint error rolls back. Immediate bridge and structural refresh must restore ordinary lint validity.

Emit `knowledge.materialization.applied` with `operation=normalize_documents`. Events contain only compiler identity, hashes, counts, coverage, and validation coordinates—not bodies, paths, prompts, or provider output.

Lifecycle records live in the sharded `.lervo/knowledge/document-normalizations` registry. Each record independently binds exact outputs, user-owned regions excluding managed blocks, and included package resources for portable skills. Managed-block refresh therefore does not stale unchanged prose; changed or missing user regions, outputs, or resources do. Applying a replacement deletes older records for the same source within the content-bound transaction. Refresh rebuildable navigation afterward.

Version 1 rewrites ordinary Markdown and portable Markdown skill material. It does not modify configuration, hooks, executable skill scripts, binary assets, sensitive sources, or provider enforcement settings, though these may remain content-hash dependencies of a skill.

## Consequences

- Migration completion requires current content-normalization records for eligible user Markdown; moved legacy bytes are insufficient.
- Existing generated entrypoints are format-owned; existing user entrypoints require reviewed normalization.
- Multi-topic documents may become short entrypoints with grouped sibling topics.
- Interrupted normalization reruns only invalidated or incomplete shards.
- Skill prose may follow repository language and format, while scripts and assets retain operational meaning and can stale the skill.
- Human approval remains the semantic-equivalence boundary.

## Superseded clauses

This decision supersedes ADR-0193 and the repository knowledge specification only where they treated byte-preserving relocation as complete migration. Exact approval, managed-block ownership, provider-configuration preservation, and the no-capability compiler boundary remain unchanged.

ADR-0199 supersedes the clause retaining root HANDOFF as the active continuation entrypoint. The handoff-document profile remains only for nested durable history.
