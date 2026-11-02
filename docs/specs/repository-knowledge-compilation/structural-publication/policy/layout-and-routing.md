# Layout and Routing

`.lervo/knowledge/document-layout.yaml` declares decision roots, leaf bounds, and semantic routes. Each route has an `id`, a `path`, a `priority`, and a prose `description` of its scope. [ADR-0476](../../../../decisions/knowledge/documents/0476-route-legacy-documents-semantically-and-never-migrate-application-content.md) defines how documents reach a route. Lervo never matches keywords or title terms against a document's name or heading to decide anything.

## Candidates

A Markdown file is a migration candidate only when it is outside the canonical trees, declared roles, local entrypoints, and provider surfaces, and when no evidence shows that the repository's own code consumes it. Application content is never a candidate. The plan lists it in `retainedDocuments` with one of these bases:

- `application_content`: a module or configuration in the same workspace package references the file, its directory, or a content glob that admits its extension. This includes imports, static template prefixes, and joined path arguments. Alternatively, the file lies in a directory tree that holds the package's own source modules. A package manifest such as `package.json`, `Cargo.toml`, or `go.mod` declares the package boundary. Tests, other packages, a bare package root, and the layout's documentation root (for example `docs/`) never count as evidence.
- `tool_owned`: [ADR-0473](../../../../decisions/knowledge/documents/0473-publish-knowledge-within-its-write-scope-and-never-rewrite-a-tool-generated-document.md) evidence shows that a repository tool writes the file.
- `semantic_provider`: the recorded semantic classification for these exact bytes returned `retain_in_place`.

Each entry carries its evidence, such as the referencing source path and resolved target. Plans list every retained candidate and its exact `retainedDocumentCount`.

## Routing bases

A candidate's destination is either a configured route or a single-document role from the layout's role catalog: every `reviewed_move` role the layout declares, plus the `product_vision`, `system_architecture`, `execution_specification`, and `delivery_roadmap` templates. It comes from the first of these bases that applies:

1. `explicit_metadata`: `lervo.document.route` or `lervo.document.role` front matter (exactly one), or `lervo.decision.route` for an ADR. This owner declaration also places Markdown that the package loads. An unknown role blocks as `unknown_document_role`.
2. `reviewed_layout_alias`: the document's exact path is a `legacyAliases` entry the layout declares for a catalog role, such as `ARCHITECTURE.md` for `system_architecture`.
3. `semantic_provider`: a recorded classification bound to the document's subject, path, content hash, and route-set digest, which covers the route and role catalogs. The move cites its `classificationId`, `recordDigest`, provider, `requestDigest`, `responseDigest`, and observation artifact hash. A semantic role whose destination already exists defers as `destination_conflict` instead of blocking.

File-name stems, headings, and keywords are never a basis. The former root rules that matched `*_VISION.md`, `*_ARCHITECTURE.md`, `*_EXECUTION_SPEC.md`, `*_ROADMAP.md`, and `V<n>_PLAN.md` stems against heading words are removed.

A candidate without either basis appears in `deferredDocuments` with its `classificationId`, `subject` (`document`, `decision`, or `instruction`), `contentHash`, `workspacePackage`, and `reason`. Each entry also requires a `resolution` under [ADR-0540](../../../../decisions/knowledge/documents/routing/0540-account-for-every-document-a-migration-defers.md):

| Resolution | Meaning |
| --- | --- |
| `background_classification` | An admitted background provider classifies the path within the delegation roots. |
| `delegation_scope` | The path is outside the delegation roots. Renewal proposes its exact file path after classification. |
| `route_metadata` | Classification was uncertain. Add `lervo.document.route` or `lervo.document.role` metadata; a decision uses `lervo.decision.route`. |
| `provider_unavailable` | No provider is available to classify the document on this host. |
| `destination_conflict` | Resolve an occupied or ambiguous destination, then rebuild the plan. Each source carries its path, `basis`, and `destination`. |

The reason is `semantic_classification_pending`, `semantic_classification_uncertain`, `destination_conflict`, or `delegation_scope`. Planning asserts a one-to-one mapping from classified candidates to moved, retained, and deferred outcomes. Destination blockers still block their exact plan, while each excluded source remains visible as a deferral. Readers treat an older entry without `resolution` as `background_classification`. Plans list every deferred candidate and its exact `deferredDocumentCount`. Any deferral makes `coverage.complete` false. Text output starts with that count and lists each path and resolution. Later migration stages preserve these fields and incomplete coverage even when the layout itself is current.

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

The background resident classifies `semantic_classification_pending` documents during the lifecycle prefix of a convergence cycle. Every pending candidate is eligible for classification, including root documents outside the delegation roots, in batches of at most eight. Classification writes host-private evidence only. Moves remain bounded by the delegation roots. Before full-body provider review, check every changed source, destination, and reference-rewrite path against current validated authority. Layout plans are atomic. When any required path is unauthorized, the plan records each move as `delegation_scope` with `basis`, `destination`, and missing `requiredPaths`. It reaches neither review nor apply. Managed knowledge outputs retain their existing authority boundary. The no-capability provider adapter receives `documentRouteClassificationInstruction`, the route ids, paths, and descriptions, the role ids and paths, and each document's path, workspace package, and first 8 KiB as untrusted data. The response schema allows exactly one of `route` with a configured `routeId`, `role` with a catalog `roleId` (documents only), `retain_in_place`, or `uncertain`, each with a short rationale. Any missing, duplicated, mismatched, or unknown-route entry is recorded as `uncertain`. The call runs under the convergence assignment, provider admission, and call budget. It records usage like other knowledge-worker calls.

Records are stored in host-private `.lervo/state/knowledge/document-route-classifications.json`. They are evidence, not canonical state. The file keeps at most 4,096 records and prunes any record that no current plan relies on or waits for. A lost record only returns its document to `pending`. A move enabled by a record still passes the exact lifecycle plan, its independent review, and apply. The materialization receipt records `classificationBases` with each destination digest, basis, and record digest.

`lervo migrate knowledge --provider codex` or `--provider claude` classifies one pending batch before building its layout review plan. It uses the same no-capability adapter, 8 KiB excerpt limit, eight-document batch bound, classification records, and host provider pause and capacity admission. Known paused, capacity, and rejected admission returns a plan with `provider_unavailable` deferrals. Unexpected admission failures still propagate. When structural migration is already current, classification unavailability returns that plan with its deferrals instead of falling through to provider normalization. Provider failure leaves the document pending with a stated resolution. The foreground command never applies a move without the existing exact plan and item approvals. Applying a plan does not call the classifier again.

[ADR-0559](../../../../decisions/knowledge/documents/routing/0559-ask-one-owner-decision-for-a-reviewed-layout-plan.md) asks a `review_required` plan with no blockers as one owner decision. `decisionId` (`klaydec_`) and `decisionHash` bind `sourceSnapshotId`, `afterSourceSnapshotId`, and every item `operationId` with its `approvalHash`; deferral labels are excluded. The plan text, operating attention (`repository_layout_decision_pending`, consequence `repository_write`), the health owner-authority line, and `lervo upgrade` show the decision with `Recommendation: accept`, one accept command (`lervo migrate knowledge --root <repository> --accept-layout <decisionId>=<decisionHash>`), and one decline command (`--decline-layout <decisionId>`). Acceptance applies exactly the current plan with every item approval; a stale or malformed token grants nothing and cannot be combined with `--apply` or `--approve-item`. Decline writes host-private `.lervo/state/knowledge/layout-decision.json` (newest 32 declines). A declined decision is not asked again; attention keeps one non-gating `repository_layout_decision_declined` advisory, and `lervo upgrade` reports the knowledge stage `deferred (layout_decision_declined)` until the plan changes, because the later knowledge stages stay uninspected. Per-item `--approve-item` approval remains available.

At delegation renewal, one `delegation_scope_change` owner decision carries all classified moves and exactly the missing source, destination, and reference-rewrite file paths needed by the atomic plan. `requiredPaths` contains those additions; `paths` carries each source classification and destination. New destination files need not exist yet. It recommends acceptance. It never proposes directories, patterns, pending guesses, or retained application content. Reconciliation replaces the current proposal instead of appending copies. Acceptance uses the existing reviewed delegation plan/apply validation. The `scope-response` subcommand records `--proposal`, `--response accept|decline`, and `--evidence-hash` bound to an existing private artifact containing the owner's response. Acceptance also supplies `--from` and `--apply` for the exact delegation plan; it adds every required file path without changing other scope fields. Decline does not apply a delegation. The existing `knowledge.materialization.applied` journal records operation `document_route_scope_decision`, proposal identity, and private receipt hashes. The receipt holds the complete proposal, response, and evidence artifact hash. A changed proposal fails as `knowledge_plan_stale`. Invalid authority, an incomplete grant, or an acceptance blocker fails as `knowledge_authority_unavailable`. A receipt hash mismatch fails as `knowledge_effect_uncertain`. No failed response grants authority. No event type is added. Reconciliation keeps the current proposal and `scopeResponse` but suppresses a declined identical owner question. Proposal identity binds current scope, classifications, required paths, and exact operations. A changed reference or source makes a new decision; expiry-only renewal does not. The existing 32-root delegation limit still applies. A larger complete proposal carries `acceptanceBlocker: normalization_root_limit`. It is never asked as a scope grant: its finding is `info`, and the owner decides the same moves once through the ADR-0559 layout decision. No partial scope or broader directory grant substitutes for it. Non-file, inaccessible, or retained application-content paths are excluded from additions and listed in `unsatisfiedPaths` with `acceptanceBlocker: scope_path_unavailable`. The move remains deferred.

## Deferral health integration

The host-private `document-deferrals.json` projection stores at most 4,096 current path hashes and their first observed timestamps. It also stores the exact count, observation time, and oldest timestamp. Each scan replaces the projection and prunes resolved paths. The oldest observations survive compaction, but `historyTruncated: true` makes the reported oldest age unknown. Unknown age persists until a scan observes zero deferrals. This prevents surviving omitted paths from receiving a fabricated first-seen time after tracked paths resolve. Older projections with a count larger than their retained history also report unknown age. Edited bytes retain the path's deferral age. No document bodies or provider messages are stored. A missing or invalid projection is unknown, never zero debt.

`inspectDocumentDeferralHealth` exposes `deferredDocumentCount`, `oldestDeferralAgeMs`, `historyTruncated`, and `observedAt`. ADR-0535 can consume these as Know measures when its health projection lands. Resolution actors are `background classifier` for `background_classification` and `provider_unavailable`, and `principal proxy` for `delegation_scope`. `route_metadata` identifies the document and required metadata; Lervo adds it after the owner settles the route in conversation. This branch does not implement the separate core health projection.

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
