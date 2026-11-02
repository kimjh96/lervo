# Layout and Routing

`.lervo/knowledge/document-layout.yaml` declares decision roots, leaf bounds, and semantic routes. Each route has an `id`, a `path`, a `priority`, and a prose `description` of its scope. [ADR-0476](../../../../decisions/knowledge/documents/0476-route-legacy-documents-semantically-and-never-migrate-application-content.md) defines how documents reach a route. Lervo never matches keywords or title terms against a document's name or heading to decide anything.

## Candidates

A Markdown file is a migration candidate only when it is outside the canonical trees, declared roles, local entrypoints, and provider surfaces, and when no evidence shows that the repository's own code consumes it. Application content is never a candidate. The plan lists it in `retainedDocuments` with one of these bases:

- `application_content`: a module or configuration in the same workspace package references the file, its directory, or a content glob that admits its extension. This includes imports, static template prefixes, and joined path arguments. Alternatively, the file lies in a directory tree that holds the package's own source modules. A package manifest such as `package.json`, `Cargo.toml`, or `go.mod` declares the package boundary. Tests, other packages, a bare package root, and the layout's documentation root (for example `docs/`) never count as evidence.
- `tool_owned`: [ADR-0473](../../../../decisions/knowledge/documents/0473-publish-knowledge-within-its-write-scope-and-never-rewrite-a-tool-generated-document.md) evidence shows that a repository tool writes the file.
- `semantic_provider`: the recorded semantic classification for these exact bytes returned `retain_in_place`.
- `layout_reverted`: the owner reverted this exact move with `lervo knowledge revert <commit>` ([ADR-0561](../../../../decisions/foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md)). The evidence names the reverted commit and the revert time. The document is planned again once its bytes change.

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
| `background_classification` | An admitted background provider classifies the path, wherever it sits in the repository. |
| `route_metadata` | Classification was uncertain. Add `lervo.document.route` or `lervo.document.role` metadata; a decision uses `lervo.decision.route`. |
| `provider_unavailable` | No provider is available to classify the document on this host. |
| `destination_conflict` | Resolve an occupied or ambiguous destination, then rebuild the plan. Each source carries its path, `basis`, and `destination`. |
| `destination_capacity` | The moves into one directory would exceed its capacity, so Lervo holds them and the source stays in place; nothing waits for the owner. A capacity override for the directory or a route elsewhere releases them. |

The reason is `semantic_classification_pending`, `semantic_classification_uncertain`, `destination_conflict`, or `destination_capacity`. Plans before ADR-0561 could also carry `delegation_scope`; readers no longer report it. Planning asserts a one-to-one mapping from classified candidates to moved, retained, and deferred outcomes. Destination blockers still block their exact plan, while each excluded source remains visible as a deferral. Readers treat an older entry without `resolution` as `background_classification`. Plans list every deferred candidate and its exact `deferredDocumentCount`. Any deferral makes `coverage.complete` false. Text output starts with that count and lists each path and resolution. Later migration stages preserve these fields and incomplete coverage even when the layout itself is current.

A deferred document never blocks the plan. Other stages proceed, and the terminal lifecycle inspection and operating attention report each deferred document as a `document_route_classification_deferred` advisory. `lervo upgrade` lists the documents in `stages.knowledge.deferredDocuments`. An ungrouped flat ADR is a lint warning while it waits.

The plan holds every move into a directory that the moves would push over its capacity ([ADR-0583](../../../../decisions/knowledge/repository/layout/0583-hold-moves-that-overfill-a-directory-and-report-existing-overflow.md)). Its `layoutCapacity` lists each directory over capacity with `observed`, `projected`, `limit`, and `disposition`: `moves_held` or `existing_overflow`. `lervo upgrade` reports the list in `stages.knowledge.layoutCapacity`, and both commands print one line per directory.

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

The background resident classifies `semantic_classification_pending` documents during the lifecycle prefix of a convergence cycle. Every pending candidate is eligible for classification, including root documents outside the delegation roots, in batches of at most eight. Classification writes host-private evidence only. Under [ADR-0561](../../../../decisions/foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md), a `review_required` layout plan is not bounded by the delegation roots: the independent lifecycle reviewer judges the exact plan, and its exact changed paths, including destinations and reference rewrites, are the whole scope of the writer assignment. Layout plans stay atomic. A plan that applies without review (`ready`) must still stay inside the delegation roots or the managed knowledge outputs. Managed knowledge outputs retain their existing authority boundary. The no-capability provider adapter receives `documentRouteClassificationInstruction`, the route ids, paths, and descriptions, the role ids and paths, and each document's path, workspace package, and first 8 KiB as untrusted data. The response schema allows exactly one of `route` with a configured `routeId`, `role` with a catalog `roleId` (documents only), `retain_in_place`, or `uncertain`, each with a short rationale. Any missing, duplicated, mismatched, or unknown-route entry is recorded as `uncertain`. The call runs under the convergence assignment, provider admission, and call budget. It records usage like other knowledge-worker calls.

Records are stored in host-private `.lervo/state/knowledge/document-route-classifications.json`. They are evidence, not canonical state. The file keeps at most 4,096 records and prunes any record that no current plan relies on or waits for. A lost record only returns its document to `pending`. A move enabled by a record still passes the exact lifecycle plan, its independent review, and apply. The materialization receipt records `classificationBases` with each destination digest, basis, and record digest.

`lervo migrate knowledge --provider codex` or `--provider claude` classifies one pending batch before building its layout review plan. It uses the same no-capability adapter, 8 KiB excerpt limit, eight-document batch bound, classification records, and host provider pause and capacity admission. Known paused, capacity, and rejected admission returns a plan with `provider_unavailable` deferrals. Unexpected admission failures still propagate. When structural migration is already current, classification unavailability returns that plan with its deferrals instead of falling through to provider normalization. Provider failure leaves the document pending with a stated resolution. The foreground command applies a move only through the exact plan and the independent cross-check below. Applying a plan does not call the classifier again.

## Applying a reviewed layout plan

[ADR-0561](../../../../decisions/foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md) replaces item approvals and the [ADR-0559](../../../../decisions/knowledge/documents/routing/0559-ask-one-owner-decision-for-a-reviewed-layout-plan.md) owner decision. Nothing waits for the owner:

- The background lifecycle prefix reviews a `review_required` plan with the independent exact lifecycle plan reviewer, then applies it through a writer assignment scoped to the parent's responsibility (`writeScope: reviewed_plan`), whatever the delegation's roots. The 32-root delegation limit no longer bounds a complete move plan. The reviewer receives the plan's `changedPaths`; whether they sit inside the roots is not a reason to reject. A rejected exact plan is parked at once by kind and plan hash as Lervo's own debt ([ADR-0485](../../../../decisions/knowledge/semantics/0485-reevaluate-settled-semantic-candidates-once-per-evaluation-contract.md)), because a deterministic plan regenerates identically.
- `lervo migrate knowledge --apply <plan-id>` on a `review_required` plan asks the same exact plan review of a fresh no-capability provider session. The provider is `--provider` when given, otherwise the provider the resident last admitted. Without one the command fails with `knowledge_cross_check_unavailable` and changes nothing. Disagreement fails with `knowledge_cross_check_disagreed`, names the reviewer's reason, and changes nothing; it is reported to the caller and never becomes an owner decision. A `ready` plan applies directly.
- Each applied plan lands as its own `Lervo Knowledge` commit, `docs: apply the cross-checked repository layout`, with the trailers `Lervo-Effect: repository_layout`, `Lervo-Effect-Plan`, `Lervo-Effect-Reason`, and `Lervo-Effect-Cross-Check`. The background stage receipt records the commit as `committedHead`. A checkout that cannot commit, such as a host that does not own convergence, keeps the applied bytes and says so. The learned notice reports the commit with its undo.
- `lervo knowledge revert <commit>` undoes the commit when every path it changed still holds the committed bytes; otherwise it fails with `revert_conflict` and changes nothing. It records each reverted move (`fromPath`, `toPath`, `contentHash`, `commit`, `revertedAt`) in tracked `.lervo/knowledge/layout-reverts.json`, keeping the newest 256, and commits the restore together with that record. Every host that pulls the revert then retains the document with basis `layout_reverted` until its bytes change.

`--accept-layout`, `--decline-layout`, and `--approve-item` for layout items are removed and fail with a message that names `lervo knowledge revert <commit>`. The `repository_layout_decision_pending` and `repository_layout_decision_declined` attention items, the upgrade `layoutDecision`, and `.lervo/state/knowledge/layout-decision.json` no longer exist. A layout plan in terminal attention is agent work (`repository_layout_review_required`, `requiresUserAction: false`).

Continuity no longer proposes a `delegation_scope_change` for layout moves, and a reader drops a proposal an older version recorded. The `scope-response` subcommand and its proposal and decision records are removed; the subcommand fails with a message that names `lervo knowledge revert <commit>`.

## Deferral health integration

The host-private `document-deferrals.json` projection stores at most 4,096 current path hashes and their first observed timestamps. It also stores the exact count, observation time, and oldest timestamp. Each scan replaces the projection and prunes resolved paths. The oldest observations survive compaction, but `historyTruncated: true` makes the reported oldest age unknown. Unknown age persists until a scan observes zero deferrals. This prevents surviving omitted paths from receiving a fabricated first-seen time after tracked paths resolve. Older projections with a count larger than their retained history also report unknown age. Edited bytes retain the path's deferral age. No document bodies or provider messages are stored. A missing or invalid projection is unknown, never zero debt.

`inspectDocumentDeferralHealth` exposes `deferredDocumentCount`, `oldestDeferralAgeMs`, `historyTruncated`, and `observedAt`. ADR-0535 can consume these as Know measures when its health projection lands. Resolution actors are `background classifier` for `background_classification` and `provider_unavailable`. `route_metadata` identifies the document and required metadata; Lervo adds it after the owner settles the route in conversation. This branch does not implement the separate core health projection.

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
