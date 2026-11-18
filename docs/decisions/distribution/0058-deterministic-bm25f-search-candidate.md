# ADR-0058: Deterministic `bm25f-v1` candidate with explicit registration

Status: `superseded`
Decision date: 2026-08-20

Superseded by [ADR-0560](../foundation/0560-remove-unused-subsystems-to-harden-the-core.md). Lervo no longer ships this capability.

## Context

The comparison contract needs a real adapter that proves equal corpus and response semantics. Arbitrary modules would turn evaluation into code execution, while adapter-local corpus validation could drift from the baseline. The first candidate must be local, reproducible, and explicit about scoring limits without being promoted automatically.

## Decision

- Shared `prepareSearchCorpus` owns source, body, path, and label limits; duplicate coordinates; canonical ordering; and the projection digest for both engines. Preserve legacy lexical index-ID semantics.
- `verifySearchEvaluationEngineContract` builds forward and reversed corpora and repeats queries. It checks stable index ID; engine, query, and index coordinates; top-50; rank; positive safe-integer scores; matched-field order; tie-breaking; result hash; and input immutability.
- `@lervo/search-adapter-bm25f` implements `bm25f-v1` using weighted term frequency—title 12, path 8, label 10, text 2—plus length normalization, saturation, and integer rarity scaled by 1,000,000.
- Use no floating-point logarithm, time, randomness, or external state. Break ties by source kind and ID. This is a fixed, integer, BM25F-inspired candidate and is not score-compatible with standard libraries.
- `SearchEvaluationEngineRegistry` accepts at most 16 explicitly supplied candidates, with unique candidate and engine/version identities. The baseline cannot be registered.
- The CLI statically registers only `bm25f-v1`. `search candidates` lists it, and `search compare ... --candidate bm25f-v1` selects it. Reject unknown strings before project reads; never resolve paths, packages, URLs, or dynamic imports.

Failures distinguish shared corpus invalidity, engine-contract violation, unregistered candidate, insufficient sample, and candidate execution failure. Do not publish a completed comparison after failure.

Evaluation may use local corpus and case queries in memory but stores no source or Hub/event data. `candidate_better_observed` does not imply adoption; operational attempts and context remain lexical.

## Consequences

A real deterministic candidate exercises the provider-neutral comparison boundary without permitting arbitrary code loading or changing production search.
