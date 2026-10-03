# Layout and Routing

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
