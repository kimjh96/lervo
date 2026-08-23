# ADR-0195: Reviewed document content normalization

- Status: accepted
- Decision date: 2026-08-24

## Context

ADR-0193 normalized paths and provider surfaces while preserving source bytes. Relocation alone leaves inconsistent structure, language, audience, duplicated concerns, oversized documents, and skills whose resources are detached from their lifecycle. Structural navigation and semantic concepts do not repair source documents.

Migration must establish the documentation system while protecting user-owned bytes and preventing untrusted prose from acquiring provider capabilities.

## Decision

Repository migration has four ordered stages:

1. Deterministic inventory, routing, provider-surface normalization, and structural publication.
2. Isolated provider content normalization.
3. Exact per-source review and durable apply.
4. Structural refresh, lint, and a current replan.

`lervo migrate knowledge --provider codex|claude` runs normalization after earlier stages are current. `lervo knowledge normalize` exposes the same stage. Provider selection changes only the adapter; both enforce a no-filesystem, no-shell, no-network, no-tool contract. Candidates are stored in ignored local state so apply uses the reviewed output without rerunning a nondeterministic model.

The normalizer receives bounded documents, explicit v1 English publication language, a format profile, and stable source-section versions. It returns one result per source, one retained entrypoint, optional grouped topic files where splitting is allowed, and complete source-section coverage. Providers use short document-local integer indexes, which Lervo validates and resolves to content-bound source-unit version IDs. Single-output rewrites bind every section to that output; only splits require section assignment.

Every output requires an H1 and must satisfy byte and line limits. README serves people and routes agents to AGENTS. AGENTS and canonical instruction pages serve agents. CLAUDE remains a thin bridge limited to 2 KiB and 40 lines. Decisions retain decision anatomy. Agent Skills retain portable identity, triggers, workflow, constraints, resources, and verification. Root handoff remains a short continuation entrypoint; independent history and subsystem details move under `docs/repository/handoffs/`.

Validation rejects missing sections, changed skill names, dropped instruction frontmatter, managed blocks, provider imports, fenced examples, link coordinates in skills or agent instructions, inline coordinates in portable skill material, unsafe paths, oversized outputs, duplicate destinations, capability telemetry, and unsupported languages. Path-scope frontmatter on canonical instructions remains byte-exact. Portable Skill descriptions may be rewritten into the publication language, but Skill names remain fixed.

General documents and prose instructions may condense inline examples; exact human review, not byte equality, establishes semantic preservation. Structural checks do not prove equivalent meaning. Each approval binds source bytes, output hashes, section coverage, skill-resource hashes, compiler build, language, and format version.

Provider work uses content-bound shards with at most three isolated provider processes active concurrently. Cache each schema-valid response under ignored local state, keyed by compiler build and the complete envelope. Interrupted or rejected work resumes at the first missing shard. Cache reuse cannot cross changes to source, policy, prompt, schema, provider, model, or adapter. Human-readable commands report shard start, completion, and reuse without adding progress to final JSON.

Loading and apply revalidate safe unique destinations, profile bounds, output hashes, complete coverage, operation and approval bindings, and the current repository's entire eligible-source and skill-resource set. Recomputing an outer candidate ID cannot conceal altered inner invariants.

Apply uses the durable knowledge journal, writing user documents and lifecycle records together. Deterministic lint runs before the event. During this stage only, `instruction_bridge_binding_stale` becomes an explicit transition warning because reviewed AGENTS or CLAUDE changes invalidate the previous bridge binding; every other lint error rolls back. The immediate bridge and structural refresh must restore ordinary lint validity.

Emit `knowledge.materialization.applied` with `operation=normalize_documents`. Events include only compiler identity, hashes, counts, coverage, and validation coordinates—not bodies, paths, prompts, or provider output.

Track lifecycle records in the sharded `.lervo/knowledge/document-normalizations` registry. Each record binds exact outputs, user-owned regions independently of managed blocks, and included package resources for portable skills. Managed-block refresh therefore does not stale unchanged prose. Changed or missing user regions, outputs, or resources do. Applying a replacement deletes older records for the same source within the content-bound transaction. Refresh rebuildable navigation afterward.

Version 1 rewrites included ordinary Markdown and portable Markdown skill material. It does not modify configuration, hooks, executable skill scripts, binary assets, sensitive sources, or provider enforcement settings. These may remain content-hash dependencies of a skill.

## Consequences

- Migration completion requires current content-normalization records for eligible user Markdown; moved legacy bytes are insufficient.
- Existing generated entrypoints are format-owned; existing user entrypoints require reviewed normalization.
- Multi-topic documents may become short entrypoints with grouped sibling topics.
- Interrupted normalization reruns only invalidated or incomplete shards.
- Skill prose may follow repository language and format while scripts and assets retain operational meaning and can stale the skill.
- Human approval remains the semantic-equivalence boundary.

## Superseded clauses

This decision supersedes ADR-0193 and the repository knowledge specification only where they considered byte-preserving relocation complete migration. Exact approval, managed-block ownership, provider-configuration preservation, and the no-capability compiler boundary remain unchanged.
