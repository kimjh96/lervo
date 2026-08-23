# ADR-0058: Deterministic `bm25f-v1` candidate with explicit registration

Status: `accepted`
Decision date: 2026-08-20

## Context

The comparison contract needs a real adapter proving equal corpus/response semantics. Accepting arbitrary modules would turn evaluation into code execution, while adapter-local corpus validation could drift from baseline. The first candidate must be local, reproducible, and explicit about scoring limits without automatic promotion.

## Decision

- Shared `prepareSearchCorpus` owns source/body/path/label limits, duplicate coordinates, canonical order, and projection digest for both engines. Preserve legacy lexical index-ID semantics.
- `verifySearchEvaluationEngineContract` builds forward/reversed corpora and repeats queries, checking stable index ID, engine/query/index coordinates, top-50, rank, positive safe-integer score, matched-field order, tie-break, result hash, and input immutability.
- `@lervo/search-adapter-bm25f` implements `bm25f-v1` with weighted term frequency (title 12, path 8, label 10, text 2), length normalization, saturation, and integer rarity scaled by 1,000,000.
- Use no floating-point logarithm, time, random, or external state. Break ties by source kind/ID. This is a fixed integer BM25F-inspired candidate, not score-compatible with standard libraries.
- `SearchEvaluationEngineRegistry` contains at most 16 explicitly supplied candidates with unique candidate and engine/version identities; baseline cannot register.
- CLI statically registers only `bm25f-v1`. `search candidates` lists it; `search compare ... --candidate bm25f-v1` uses it. Reject unknown strings before project reads and never resolve paths/packages/URLs/dynamic imports.

Failures distinguish shared corpus invalidity, engine-contract violation, unregistered candidate, insufficient sample, and candidate execution failure. Publish no completed comparison on failure.

Evaluation may use local corpus/case queries in memory but stores no source or Hub/event data. `candidate_better_observed` is not adoption; operational attempts/context remain lexical.

## Consequences

A real deterministic candidate exercises the provider-neutral comparison boundary without opening arbitrary code loading or changing production search.
