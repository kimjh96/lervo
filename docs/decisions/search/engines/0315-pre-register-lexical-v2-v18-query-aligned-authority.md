# ADR-0315: Pre-register lexical-v2 v18 query-aligned authority

Status: accepted for evaluation only
Date: 2026-08-31

## Context

Codex v17 passed the unchanged duration gate at 91.86%, token gate at 79.58%, all preparation, provider, tool, schema, and absolute quality floors, but failed case-level non-regression. In two of three CLI release-status repetitions, both required evidence candidates were present, but the model cited the related release-automation roadmap instead of the directly answering CLI version-management distribution specification.

Both documents have the `canonical_current` role, so the pipeline preserved raw retrieval order. Query-selected section scoring independently rated the distribution specification 440,700 and the roadmap 401,300 for the public query. Across all twelve frozen cases, sorting sources within an authority role by this existing query-alignment score places every expected source first while retaining both expected sources for the two-source conflict case.

## Decision

Create `lv2bench_provider_comparison.v18`, preserving the complete v17 suite, preparation mode, strict schema, protocol, evidence delivery, models, repetitions, invocation maximum, and acceptance gates.

Within `prioritizeCanonicalEvidence`, retain authority-role ordering, then sort sources in the same role by descending query-selected section score and original retrieval rank. Historical-rationale queries still place decisions first. Current queries still place specifications, foundations, distribution, and roadmap sources before decisions. The policy must not use any case identifier, expected path, provider identity, or Lervo-specific filename.

## Consequences

The change makes an existing general relevance signal decisive only after authority classification. It may change presentation order but cannot add sources, expand the document cap, increase injected bytes, or bypass engine ranking and bounded expansion.

Lexical-v1 remains operational. V18 is ineligible for activation unless fresh Codex and Claude reports independently pass every unchanged criterion. Retain failed reports without retrying them.

## Verification

- Focused authority-order tests, including the CLI distribution-versus-roadmap regression.
- Both lexical-v2 local capability challenge suites and provider-free v18 selection checks.
- Fresh sequential Codex and Claude v18 reports.
- Full repository and release-completion checks before any activation transition.
