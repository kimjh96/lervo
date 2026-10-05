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

## Contract diagnostics

Layout validation reports every violation as a structured issue: `pointer` (an RFC 6901 JSON pointer into the parsed file, such as `/documentPolicy/rewrite` or `/routes`), `rule` (`required`, `type`, `const`, `pattern`, `range`, `enum`, `min_items`, `max_items`, `unique`, `repository_path`, `document_path`, or `title_term`), an optional `roleId` for document-policy roles, and `message`. The thrown `contract_invalid` error carries the full issue list, and its message names at most 16 issues. Issues contain only layout coordinates and rule names, never document content.

Structural migration and refresh plans load the layout as apply-time lint does. An invalid, unparsable, or unreadable layout adds a `document_layout_contract_invalid`, `document_layout_invalid_yaml`, or `document_layout_unreadable` blocker with the same issues, so the plan is `blocked` instead of reporting ready and then failing during apply. With `--json`, a command failure is one `{ schemaVersion: 1, status: "failed", error: { code, message, issues?, ... } }` envelope on stdout, with no unstructured stderr text. A blocked plan apply fails as `knowledge_plan_blocked` with its blockers and conflicts.
