# Candidates and Routing

## Candidates

A Markdown file is a migration candidate only if it is outside canonical trees, declared roles, local entrypoints, and provider surfaces, and no evidence shows that repository code consumes it. Application content is never a candidate. The plan lists retained files in `retainedDocuments` with one of these bases:

- `application_content`: a module or configuration in the same workspace package references the file, its directory, or a content glob admitting its extension. Imports, static template prefixes, and joined path arguments qualify. Alternatively, the file lies in a directory tree holding the package's own source modules. A manifest such as `package.json`, `Cargo.toml`, or `go.mod` defines the package boundary. Tests, other packages, a bare package root, and the layout's documentation root (for example `docs/`) never count as evidence.
- `tool_owned`: [ADR-0473](../../../../../decisions/knowledge/documents/0473-publish-knowledge-within-its-write-scope-and-never-rewrite-a-tool-generated-document.md) evidence shows that a repository tool writes the file.
- `semantic_provider`: recorded semantic classification for these exact bytes returned `retain_in_place`.

Each entry includes evidence, such as the referencing source path and resolved target. Plans report at most 256 entries and an exact `retainedDocumentCount`.

## Routing bases

A candidate's destination is a configured route or a single-document role from the layout's role catalog: all declared `reviewed_move` roles plus the `product_vision`, `system_architecture`, `execution_specification`, and `delivery_roadmap` templates. Use the first applicable basis:

1. `explicit_metadata`: exactly one of `lervo.document.route` or `lervo.document.role` in front matter, or `lervo.decision.route` for an ADR. This owner declaration also places Markdown that the package loads. Unknown roles block as `unknown_document_role`.
2. `reviewed_layout_alias`: the document's exact path appears in the layout's `legacyAliases` for a catalog role, such as `ARCHITECTURE.md` for `system_architecture`.
3. `semantic_provider`: recorded classification bound to the document's subject, path, content hash, and route-set digest covering both route and role catalogs. The move cites `classificationId`, `recordDigest`, provider, `requestDigest`, `responseDigest`, and observation artifact hash. A semantic role whose destination already exists defers as `semantic_classification_uncertain` instead of blocking.

File-name stems, headings, and keywords are never routing bases. Former root rules matching `*_VISION.md`, `*_ARCHITECTURE.md`, `*_EXECUTION_SPEC.md`, `*_ROADMAP.md`, and `V<n>_PLAN.md` stems against heading words are removed.

## Deferrals and blockers

A candidate without an applicable basis appears in `deferredDocuments` with `classificationId`, `subject` (`document`, `decision`, or `instruction`), `contentHash`, `workspacePackage`, and `reason`:

| Reason | Meaning | Resolution |
| --- | --- | --- |
| `semantic_classification_pending` | No classification exists for these bytes and routes. | The background resident classifies it under its delegation, or the owner adds explicit metadata. |
| `semantic_classification_uncertain` | The classifier returned `uncertain` or an invalid answer for these bytes. | The owner adds explicit metadata or excludes the path in `.lervo/knowledge/policy.yaml`. New bytes or routes trigger reclassification. |

Deferred documents never block the plan; other stages proceed. Terminal lifecycle inspection and operating attention each report every deferred document as a `document_route_classification_deferred` advisory. `lervo upgrade` lists them in `stages.knowledge.deferredDocuments`. An ungrouped flat ADR remains a lint warning while waiting.

Plans still block on `invalid_document_metadata`, `unknown_document_route`, `unknown_document_role`, `invalid_decision_metadata`, `unknown_decision_route`, `invalid_decision_heading`, colliding destinations, and leaf overflow.

```yaml
---
lervo:
  decision:
    taxonomy: decisions.default
    route: execution.providers
---
```

The taxonomy and route must exist. Invalid or stale metadata blocks planning.
