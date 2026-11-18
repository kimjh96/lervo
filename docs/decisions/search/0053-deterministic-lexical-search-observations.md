# ADR-0053: Deterministic lexical search with explicit failure observations

- Status: `accepted`
- Decision date: 2026-08-20

Partially superseded by [ADR-0560](../foundation/0560-remove-unused-subsystems-to-harden-the-core.md): the assessment part is removed. Lervo no longer ships `SearchAssessment`, the assessment report, or `lervo search assess` and `lervo search report`. Lexical search, its derived index, and local `SearchAttempt` observations stay.

## Context

Before embeddings or RAG, Lervo needs evidence showing which queries lexical search fails and why. Zero hits alone do not require semantic search, and clicks or model self-evaluation do not prove relevance. Search indexes must remain derived, and queries and bodies must not leak into telemetry.

## Decision

### Source and derived index

- Provider/filesystem/Hub-independent `@lervo/search` implements `lexical-v1`. Inputs contain controlled kind, source ID/hash, optional relative path, title/label, and text used only during search.
- `@lervo/search-local` safely reads only registered Markdown, including legacy registries without migrating them.
- The in-memory index is rebuilt per request using NFKC, Unicode letter/number terms, fixed integer weights for title/path/label/text, exact/partial matching, and source-ID tie-breaks.
- `indexId` is derived from the engine version and sorted source coordinates plus digests of actual projections. No model, embedding, external search, or time-dependent score is used.
- Bounds are 131,072 characters per source text, 128 KiB per local document, 16 MiB and 4,096 sources per corpus, 500 characters and 32 terms per query, and 50 results. Any unsafe, missing, changed, non-UTF-8, or oversized source rejects the entire corpus.
- Results expose only coordinates, hash, rank, integer score, and matched fields—never bodies. A hit is not selected, loaded, injected, or used.

### Attempts and assessments

`SearchAttempt` is one immutable local observation containing project/time/nonce/content-derived ID, engine/index, query digest/length/term count/limit, result-set hash, and bounded hit coordinates. It excludes query/terms/paths/titles/labels/bodies/prompts/results/credentials. The query digest is pseudonymous, not anonymous, so it is retained only in mode-`0600` `.lervo/state/search/attempts/<attemptId>.json`, never Hub.

Quality exists only through one immutable `SearchAssessment` per attempt, produced by `human` or independent `verification`. It is `accepted` or `failed`; acceptance identifies an actual returned source kind/ID. Failure reasons are limited to `no_results`, `expected_source_missing`, `low_rank`, `results_not_relevant`, and `insufficient_context`; `no_results` requires zero hits. Hit count, clicks, and model output never create automatic assessments. Store one file per assessment.

Reports read at most 10,000 independent files and revalidate all IDs, hashes, projects, times, and relationships. Records are never deleted or overwritten; exceeding the bound fails until an archival policy exists. CLI query, assess, and report remain separate. Report evidence is `insufficient_assessment`, `no_failures_observed`, or `failures_observed`, while `embeddingDecision=not_determined` always. No execution event or Hub sync is added.

Failures distinguish invalid query/corpus/read, invalid or conflicting observations, unsafe storage, and report-limit overflow. A partial corpus is never searched, and corrupt observations are never silently omitted.

## Consequences

The baseline is raw registered-Markdown lexical search only: no verified knowledge, skills, morphology, synonyms, semantic search, or automatic context. Future comparisons require representative queries, independent expected sources, and identical evaluations.
