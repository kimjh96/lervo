# Policy and Preservation Boundaries

Tracked `.lervo/knowledge/policy.yaml` includes:

```yaml
publicationRoot: docs/knowledge
publication:
  language: en
  maxNavigationEntries: 24
  maxNavigationBytes: 8192
normalization:
  exclude: []
limits:
  maxFiles: 20000
  maxFileBytes: 1048576
  maxTotalBytes: 67108864
```

V1 supports only `en`. Language affects generated prose and titles, not identities or user bytes. Neutral localized labels preserve exact encoded paths. Unsupported values fail before planning.

The 64 MiB aggregate byte bound covers ordinary repository sources and the independently bounded execution-event and verification-result supplemental corpora. The scanner applies this bound after each admitted source and fails closed on overflow. Supplemental adapters retain stricter per-source, count, and 16 MiB per-corpus limits.

A bounded tracked `normalization.exclude` list may exclude governed user documents only from provider rewriting; structural compilation and query retain them. Exact patterns remain policy-hash inputs and never become scanner exclusions.

## Layout and routing

`.lervo/knowledge/document-layout.yaml` declares decision roots, leaf bounds, and semantic routes. Explicit ADR metadata outranks title terms. No match or a tie blocks migration; there is no implicit `foundation` fallback. Initialization writes a product-neutral taxonomy. Reviewed route changes bind the plan and taxonomy hash.

```yaml
---
lervo:
  decision:
    taxonomy: decisions.default
    route: execution.providers
---
```

The taxonomy and route must exist. Invalid or stale metadata blocks planning.

## Preservation boundaries

`docs/archive/**`, `docs/inherited/**`, and exact repository role paths with `relocation: preserve` are canonical preservation boundaries. Scanning, structural compilation, capacity evaluation, and query retain their sources.

Generic layout migration never relocates these sources, interprets preserved collection frontmatter as current Lervo route metadata, or rewrites archive or inherited collection bytes through reference repair or provider normalization.
