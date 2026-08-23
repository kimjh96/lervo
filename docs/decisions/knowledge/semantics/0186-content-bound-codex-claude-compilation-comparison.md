# ADR-0186: Content-Bound Codex–Claude Compilation Comparison

- Status: accepted
- Decision date: 2026-08-23

## Context

Independent, unreviewed compiler candidates lacked a common comparison. Manual comparison can mix snapshots or policies and mistake provider IDs or similar prose for agreement. Automatic merging would improperly elevate generated material.

## Decision

`lervo knowledge compare --codex <id> --claude <id>` validates canonical candidates from exactly those providers. The current source snapshot, policy, scanner/partitioner build, coverage, shard, and inventory must match.

Concept signatures hash the concept type, title and summary digests, and sorted claim signatures. Claim signatures hash the statement digest and sorted evidence unit-version IDs. Relation signatures hash the exact endpoint structure, relation type, and evidence. Provider concept IDs and semantic similarity are ignored.

Sorted signature multisets classify results as `exact_match`, `partial_overlap`, `disjoint`, or `empty`. Exactness means only byte-derived multiset equality; it does not establish consensus, truth, review, verification, or usability.

Comparison is read-only. It creates no candidate, publication, assurance, event, or session. The comparison ID binds both artifacts and builds plus every source, policy, and coverage group.

Each provider is limited to 8,192 concepts, 8,192 claims, and 8,192 relations. Exceeding a limit fails without a partial comparison. Results contain only IDs, digests, internal subject IDs, and counts. They never contain statements, titles, summaries, paths, prompts, outputs, secrets, or absolute paths.

Swapped providers fail with `knowledge_compile_failed`. Source, policy, coverage, or current-state drift fails with `knowledge_plan_stale`. Overflow fails with `knowledge_source_limit_exceeded`.

## Consequences

Fixtures verify exact matches despite different provider IDs, partial overlap, deterministic IDs, fail-closed provider or source drift, privacy, and preservation of the candidates' unreviewed meaning.
