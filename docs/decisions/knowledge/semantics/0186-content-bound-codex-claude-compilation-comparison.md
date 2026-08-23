# ADR-0186: Content-Bound Codex–Claude Compilation Comparison

- Status: accepted
- Decision date: 2026-08-23

## Context

Independent unreviewed compiler candidates lacked a common comparison. Manual comparison can mix snapshots/policies or mistake provider IDs and similar prose for agreement; automatic merge would improperly elevate generation.

## Decision

lervo knowledge compare --codex <id> --claude <id> validates canonical candidates from exactly those providers. Current source snapshot, policy, scanner/partitioner build, coverage, shard, and inventory must match.

Concept signatures hash type, title/summary digests, and sorted claim signatures; claims hash statement digest plus sorted evidence unit-version IDs. Relations hash exact endpoint structure, type, and evidence. Provider concept IDs and semantic similarity are ignored.

Sorted signature multisets classify exact_match, partial_overlap, disjoint, or empty. Exact means only byte-derived multiset equality—not consensus, truth, review, verification, or use. Comparison is read-only and creates no candidate/publication/assurance/event/session. Its ID binds both artifacts/builds and all source/policy/coverage groups.

Each provider is capped at 8,192 concepts, claims, and relations without partial comparison. Results contain only IDs, digests, internal subject IDs, and counts—never statements, titles, summaries, paths, prompts, outputs, secrets, or absolute paths.

Swapped providers fail knowledge_compile_failed; source/policy/coverage/current drift fails knowledge_plan_stale; overflow fails knowledge_source_limit_exceeded.

## Consequences

Fixtures verify exact matches despite different IDs, partial overlap, deterministic IDs, fail-closed provider/source drift, privacy, and preserved unreviewed meaning.
