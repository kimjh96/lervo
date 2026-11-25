# ADR-0192: Repository-scoped fail-closed decision taxonomy

Status: `accepted`
Amended by: [ADR-0464](../documents/0464-report-document-drift-and-historical-documents.md), [ADR-0476](../documents/0476-route-legacy-documents-semantically-and-never-migrate-application-content.md)

As of: 2026-08-23

## Context

ADR-0191 introduced bounded semantic decision directories, but its classifier embedded Lervo-specific regular expressions and routed every unmatched title to `foundation`. The leaf limit delayed unbounded growth without establishing a valid semantic destination. Repositories also need distinct decision domains without Lervo code changes.

## Decision

- Each initialized repository tracks its taxonomy at `.lervo/knowledge/document-layout.yaml`.
- Fresh initialization installs a conservative, product-neutral starter taxonomy. It never copies Lervo-specific search, provider, Hub, or release domains into another repository. Owners may tailor it to repository evidence before the first ADR migration.
- The taxonomy defines the canonical decision root, legacy roots, leaf-document limit, allowed route IDs and paths, deterministic title-term evidence, and explicit precedence.
- A flat ADR may choose a route through bounded `lervo.decision` front matter. Otherwise, title terms may select only one strongest configured route.
- Missing evidence, tied strongest matches, invalid metadata, unknown routes, legacy nested layouts, unknown canonical directories, and leaf overflow block migration. Nothing falls back to `foundation` or another catch-all.
- An existing canonical directory is an explicit route choice. Lervo does not reclassify grouped user documents from title inference alone.
- If taxonomy refinement retires a route, legacy-root move lineage may permit deterministic reclassification of its current documents. Documents without that lineage require explicit handling.
- Every user-document move binds exact source bytes, destination, reference updates, and per-item approval.
- Initialization creates the taxonomy file but no decision directory. Directories are created only when used.

## Consequences

If defined, `foundation` is an ordinary semantic route, not a default; the product-neutral starter omits it. Owners and agents extend or refine domains through one reviewed tracked file. Migration and lint share route and capacity rules, causing failure before semantic overflow creates an unsearchable directory.
