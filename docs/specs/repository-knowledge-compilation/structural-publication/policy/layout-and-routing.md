# Layout and Routing

`.lervo/knowledge/document-layout.yaml` declares decision roots, leaf bounds, and semantic routes. Each route has an `id`, a `path`, a `priority`, and a prose `description` of its scope. [ADR-0476](../../../../decisions/knowledge/documents/0476-route-legacy-documents-semantically-and-never-migrate-application-content.md) defines how documents reach a route. Lervo never matches keywords or title terms against a document's name or heading to decide anything.

## Candidates

A Markdown file is a migration candidate only when it is outside the canonical trees, declared roles, local entrypoints, and provider surfaces, and when no evidence shows that the repository's own code consumes it. Application content is never a candidate. The plan lists it in `retainedDocuments` with one of these bases:

- `application_content`: a module or configuration in the same workspace package references the file, its directory, or a content glob that admits its extension. This includes imports, static template prefixes, and joined path arguments. Alternatively, the file lies in a directory tree that holds the package's own source modules. A package manifest such as `package.json`, `Cargo.toml`, or `go.mod` declares the package boundary. Tests, other packages, a bare package root, and the layout's documentation root (for example `docs/`) never count as evidence.
- `tool_owned`: [ADR-0473](../../../../decisions/knowledge/documents/0473-publish-knowledge-within-its-write-scope-and-never-rewrite-a-tool-generated-document.md) evidence shows that a repository tool writes the file.
- `semantic_provider`: the recorded semantic classification for these exact bytes returned `retain_in_place`.

Each entry carries its evidence, such as the referencing source path and resolved target. Plans report at most 256 entries plus an exact `retainedDocumentCount`.

## Routing bases

A candidate's destination is either a configured route or a single-document role from the layout's role catalog: every `reviewed_move` role the layout declares, plus the `product_vision`, `system_architecture`, `execution_specification`, and `delivery_roadmap` templates. It comes from the first of these bases that applies:

1. `explicit_metadata`: `lervo.document.route` or `lervo.document.role` front matter (exactly one), or `lervo.decision.route` for an ADR. This owner declaration also places Markdown that the package loads. An unknown role blocks as `unknown_document_role`.
2. `reviewed_layout_alias`: the document's exact path is a `legacyAliases` entry the layout declares for a catalog role, such as `ARCHITECTURE.md` for `system_architecture`.
3. `semantic_provider`: a recorded classification bound to the document's subject, path, content hash, and route-set digest, which covers the route and role catalogs. The move cites its `classificationId`, `recordDigest`, provider, `requestDigest`, `responseDigest`, and observation artifact hash. A semantic role whose destination already exists defers as `semantic_classification_uncertain` instead of blocking.

File-name stems, headings, and keywords are never a basis. The former root rules that matched `*_VISION.md`, `*_ARCHITECTURE.md`, `*_EXECUTION_SPEC.md`, `*_ROADMAP.md`, and `V<n>_PLAN.md` stems against heading words are removed.

A candidate without either basis appears in `deferredDocuments` with its `classificationId`, `subject` (`document`, `decision`, or `instruction`), `contentHash`, `workspacePackage`, and `reason`:

| Reason                              | Meaning                                                                       | Resolution                                                                                          |
| ----------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `semantic_classification_pending`   | No classification exists for these bytes and routes.                          | The background resident classifies it under its delegation, or the owner adds explicit metadata.    |
| `semantic_classification_uncertain` | The classifier returned `uncertain` or an invalid answer for these bytes.     | The owner adds explicit metadata or excludes the path in `.lervo/knowledge/policy.yaml`. New bytes or new routes reclassify it. |

A deferred document never blocks the plan. Other stages proceed, and the terminal lifecycle inspection and operating attention report each deferred document as a `document_route_classification_deferred` advisory. `lervo upgrade` lists the documents in `stages.knowledge.deferredDocuments`. An ungrouped flat ADR is a lint warning while it waits.

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

## Semantic classification

The background resident classifies `semantic_classification_pending` documents during the lifecycle prefix of a convergence cycle. Only documents inside the delegation's normalization roots are eligible, in batches of at most eight. The no-capability provider adapter receives `documentRouteClassificationInstruction`, the route ids, paths, and descriptions, the role ids and paths, and each document's path, workspace package, and first 8 KiB as untrusted data. The response schema allows exactly one of `route` with a configured `routeId`, `role` with a catalog `roleId` (documents only), `retain_in_place`, or `uncertain`, each with a short rationale. Any missing, duplicated, mismatched, or unknown-route entry is recorded as `uncertain`. The call runs under the convergence assignment, provider admission, and call budget. It records usage like other knowledge-worker calls.

Records are stored in host-private `.lervo/state/knowledge/document-route-classifications.json`. They are evidence, not canonical state. The file keeps at most 4,096 records and prunes any record that no current plan relies on or waits for. A lost record only returns its document to `pending`. A move enabled by a record still passes the exact lifecycle plan, its independent review, and apply. The materialization receipt records `classificationBases` with each destination digest, basis, and record digest.

## Legacy title terms

Layouts written before ADR-0476 may still contain `titleTerms` and `minimumTitleTermMatches`. Loading accepts them only for compatibility and converts them into the route's `description`. They never decide a route. The next layout plan rewrites such a layout as a Lervo-managed `describe_semantic_routes` update, or as `upgrade_document_policy` for schema 1. The update replaces the terms with that description, and the route-set digest stays the same.

## Contract diagnostics

Layout validation reports every violation as a structured issue with:

- `pointer`: an RFC 6901 JSON pointer into the parsed file, such as `/documentPolicy/rewrite` or `/routes`.
- `rule`: `required`, `type`, `const`, `pattern`, `range`, `enum`, `min_items`, `max_items`, `unique`, `repository_path`, `document_path`, `route_description`, or `title_term` (legacy terms only).
- Optional `roleId` for document-policy roles.
- `message`.

The thrown `contract_invalid` error carries the full issue list; its message names at most 16 issues. Issues contain only layout coordinates and rule names, never document content.

Structural migration and refresh plans load the layout as apply-time lint does. An invalid, unparsable, or unreadable layout adds a `document_layout_contract_invalid`, `document_layout_invalid_yaml`, or `document_layout_unreadable` blocker, respectively, with the same issues. The plan is `blocked` instead of reporting ready and then failing during apply.

With `--json`, a command failure emits one `{ schemaVersion: 1, status: "failed", error: { code, message, issues?, ... } }` envelope on stdout, with no unstructured stderr text. Applying a blocked plan fails as `knowledge_plan_blocked` with its blockers and conflicts.
