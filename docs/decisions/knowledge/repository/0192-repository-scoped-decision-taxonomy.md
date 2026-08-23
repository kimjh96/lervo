# ADR-0192: Repository-scoped fail-closed decision taxonomy

Status: `accepted`

As of: 2026-08-23

## Context

ADR-0191 introduced bounded semantic decision directories, but its classifier embedded Lervo-specific regular expressions in migration code and sent every unmatched title to `foundation`. The leaf limit stopped unbounded growth only after the fallback directory filled; it did not establish a valid semantic destination. Different repositories also need different decision domains without changing Lervo code.

## Decision

- Each initialized repository tracks its decision taxonomy at `.lervo/knowledge/document-layout.yaml`.
- Fresh initialization installs a conservative product-neutral starter taxonomy. It never copies Lervo's own search, provider, Hub, or release domains into another product repository. The tracked file may then be tailored to repository evidence before the first ADR migration.
- The taxonomy declares the canonical decision root, legacy roots, leaf-document limit, allowed route IDs and paths, and deterministic title-term evidence with explicit precedence.
- A flat ADR may select a route explicitly through bounded `lervo.decision` front matter. Otherwise, title terms may select only one strongest configured route.
- Missing evidence, equal strongest matches, invalid metadata, unknown routes, legacy nested layouts, unknown canonical directories, and leaf overflow block migration. None falls back to `foundation` or another catch-all directory.
- An existing canonical directory is an explicit route choice. Lervo does not silently reclassify already grouped user documents from title inference alone.
- When a tracked route is retired during taxonomy refinement, a legacy-root move lineage may make its current documents eligible for deterministic reclassification. Documents without that lineage remain blocked for explicit handling.
- Every user-document move remains bound to its exact source bytes, destination, reference updates, and per-item approval.
- Initialization creates the taxonomy file but does not create any decision directory. Directories remain lazy and exist only when a document uses them.

## Consequences

`foundation`, when a repository chooses to define it, is a normal semantic route rather than a default. The product-neutral starter does not define it. Repository owners and agents can extend or refine domains by reviewing one tracked configuration file. Migration and lint share the same route and capacity contract, so a repository fails before semantic overflow becomes an unsearchable folder.
