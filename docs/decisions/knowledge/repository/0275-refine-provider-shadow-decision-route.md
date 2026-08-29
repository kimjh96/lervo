# ADR-0275: Refine the provider-shadow decision route

Status: `accepted`
Date: 2026-08-29

## Context

The `docs/decisions/search/activation` leaf reached its reviewed 24-document limit when ADR-0274 added another bounded provider-shadow experiment. Raising the limit would obscure a stable semantic split: the recent common structured-carrier compatibility and relational-coverage decisions form a bounded lineage within the broader activation history.

## Decision

Add the repository-scoped `search.activation.provider-shadow-structured` route at `docs/decisions/search/activation/provider-shadow-structured`, with higher priority than the parent activation route. Use bounded title evidence to route the cohesive lineage covering the structured Codex provider-shadow carrier, structured selection, compatible structured provider-shadow, and relational coverage.

Move ADR-0270 through ADR-0274 when their titles match that evidence. Retain the earlier registered-corpus and provider-shadow experiment history in the parent activation route. Preserve decision identity and bytes through reviewed structure-move plans, update repository references in the same transaction, and retain the 24-document leaf limit.

## Consequences

Structured provider-shadow decisions gain a cohesive bounded route, while the parent activation route retains earlier activation history. The new directory is created with its first artifacts. Migration and lint continue to reject unknown routes and future overflow. No archive, date bucket, catch-all path, or capacity exception is introduced.
