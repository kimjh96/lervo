# ADR-0053: Deterministic lexical search with explicit failure observations

Status: `accepted`
Decision date: 2026-08-20

## Context

Before embeddings or RAG, Lervo needs evidence of which queries lexical search fails and why. Zero hits alone do not require semantic search, and clicks or model self-evaluation do not prove relevance. Search indexes must remain derived and queries/bodies must not leak into telemetry.

## Decision

### Source and derived index

- Provider/filesystem/Hub-independent `@lervo/search` implements `lexical-v1`. Inputs contain controlled kind, source ID/hash, optional relative path, title/label, and text used only during search.
- `@lervo/search-local` safely reads only registered Markdown, including legacy registries without migrating them.
- Rebuild the in-memory index per request using NFKC, Unicode letter/number terms, fixed integer weights by title/path/label/text, exact/partial matching, and source-ID tie-breaks.
- Derive `indexId` from engine version and sorted source coordinates plus digests of actual projections. Use no model, embedding, external search, or time-dependent scores.
- Bound source text to 131,072 characters, local document to 128 KiB, corpus to 16 MiB/4,096 sources, query to 500 characters/32 terms, and results to 50. Any unsafe/missing/changed/non-UTF-8/oversized source rejects the whole corpus.
- Results expose coordinates/hash/rank/integer score/matched fields only, never bodies. A hit is not selected, loaded, injected, or used.

### Attempts and assessments

`SearchAttempt` is one immutable local observation: project/time/nonce/content-derived ID, engine/index, query digest/length/term count/limit, result-set hash, and bounded hit coordinates. It excludes query/terms/paths/titles/labels/bodies/prompts/results/credentials. Query digest is pseudonymous, not anonymous, so keep it only in mode-`0600` `.lervo/state/search/attempts/<attemptId>.json`, never Hub.

Quality exists only with one immutable `SearchAssessment` per attempt from `human` or independent `verification`. It is `accepted` or `failed`; acceptance names an actual returned source kind/ID. Failure reasons are only `no_results`, `expected_source_missing`, `low_rank`, `results_not_relevant`, or `insufficient_context`; `no_results` requires zero hits. Never auto-assess from hit count, click, or model output. Store one file per assessment.

Reports read at most 10,000 independent files and revalidate all IDs/hashes/projects/times/relationships. Do not delete/overwrite; fail beyond the bound until archival policy exists. CLI query, assess, and report remain separate. Report evidence is `insufficient_assessment`, `no_failures_observed`, or `failures_observed`, while `embeddingDecision=not_determined` always. Add no execution event or Hub sync.

Failures distinguish invalid query/corpus/read, invalid/conflicting observations, unsafe storage, and report-limit overflow. Never silently search a partial corpus or omit corrupt observations.

## Consequences

The baseline is raw registered-Markdown lexical search only—no verified knowledge, skills, morphology, synonyms, semantic search, or automatic context. Future comparisons require representative queries, independent expected sources, and identical evaluations.
