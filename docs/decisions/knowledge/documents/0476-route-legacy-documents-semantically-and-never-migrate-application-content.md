# ADR-0476: Route legacy documents semantically and never migrate application content

Status: `accepted`
Decision date: 2026-10-06
Amends: [ADR-0199](../repository/0199-structured-workstream-continuation-state.md) (continuation discovery), [ADR-0192](../repository/0192-repository-scoped-decision-taxonomy.md) (route selection), [ADR-0193](../repository/0193-semantic-repository-and-agent-surface-migration.md) (document candidacy), [ADR-0222](../repository/0222-bounded-role-based-document-layout.md)

## Context

On WSL, `lervo upgrade` in `flemo` with CLI 0.20.0 (main `9c4598e8`) reported the knowledge stage as `blocked` with `unclassified_document` for four files: `apps/web/app/[lang]/docs/_data/writing-guide.md`, `.../writing-guide/korean.md`, `.../sentences.md`, and `.../vocabulary.md`. The flemo.dev web app renders these files; they are application content, not repository documentation.

Two rules in `document-layout.ts` caused the block:

- Candidacy treated nearly every `.md` or `.mdx` file outside canonical trees as a legacy document to move.
- Routing matched route `titleTerms` from `.lervo/knowledge/document-layout.yaml` against the basename and first heading. Flat ADRs used the same rule; Claude rules used basename patterns. A document matching no term blocked the entire upgrade.

The owner has repeatedly prohibited keyword or title-term rules for semantic decisions because keywords are too limited. Moving content that code loads by path also breaks the application.

## Decision

### Evidence determines candidacy

Markdown consumed by the repository's own code or build is application content and never a migration candidate. Observed evidence is reported per document in `retainedDocuments`:

- `source_reference`: a module or configuration in the same workspace package references the file, its directory, or a content glob admitting its extension. Imports, static template prefixes, and adjacent path arguments count.
- `source_tree_member`: the file lies in a directory tree containing the package's own source modules.

A package manifest declares the package boundary. Tests, other packages, a bare package-root reference, and the layout's documentation root never count as evidence. Tool ownership under [ADR-0473](0473-publish-knowledge-within-its-write-scope-and-never-rewrite-a-tool-generated-document.md) also retains a document in place.

### Semantic routing

Routing follows this precedence:

1. Explicit `lervo.document.route`, `lervo.document.role`, or `lervo.decision.route` metadata is the owner's declaration and takes precedence even for content a package loads.
2. An exact `legacyAliases` path declared by the reviewed layout for a document role places that file in the role.
3. Otherwise, routing requires a recorded classification from the no-capability provider adapter, bound to the document's subject, path, content hash, and route-set digest.

Classification returns `route` with a configured route, `role` with a catalog role for a document, `retain_in_place`, or `uncertain`. A semantic role whose destination already exists is deferred, not blocked.

### Remove keyword, title, and stem decisions

No keyword, title, or stem rule may decide anything in the document and knowledge layers. Remove all of these rules:

- Title-term route matching for documents and flat ADRs.
- Basename and title-term routing for Claude rules, including `notification`, `widget`, `bridge`, `supabase`, `entity`, `app-`, and `web-` name patterns and the `repository` fallback.
- Root role recognition from `*_VISION`, `*_ARCHITECTURE`, `*_EXECUTION_SPEC`, `*_ROADMAP`, and `V<n>_PLAN` stems plus heading words.
- Continuation discovery scored from filenames, headings, and phrases. A continuation source must instead be the declared `HANDOFF.md` alias, `lervo.workstream.continuation: true` front matter, or an exact `--continuation-source` selection.
- Normalization handoff profile selection from those name and heading words. It follows the same continuation declaration instead.

### Defer unclassified candidates

A candidate without metadata or a current classification appears in `deferredDocuments` as `semantic_classification_pending` or `semantic_classification_uncertain`. It never blocks the plan or `lervo upgrade`. Each deferred document produces a `document_route_classification_deferred` attention advisory and a line in the upgrade's knowledge stage. An ungrouped flat ADR produces a lint warning.

### Classify in the background

In the convergence lifecycle prefix, the background resident classifies pending documents within the delegation's normalization roots, at most eight per call. Calls use the existing assignment, provider admission, call budget, and usage measurement. Missing, mismatched, or unknown-route answers are recorded as `uncertain`, so the same bytes are never queried twice. Resulting moves still pass the exact lifecycle plan, its independent review, and apply.

### Describe routes

Each route carries a prose `description` used only as classifier context. Existing `titleTerms` remain readable for compatibility with older layouts. Loading converts them into the description; the next layout plan rewrites the layout through a Lervo-managed `describe_semantic_routes` update.

CLI 0.20.0 and earlier require `titleTerms` and reject rewritten layouts. Every host sharing a repository must run a CLI implementing this decision before the rewrite lands.

## Determinism and audit

A plan is a pure function of scanned bytes, the layout, and recorded classifications. Each semantic move records `classificationId`, `recordDigest`, the provider, `requestDigest`, `responseDigest`, and the observation artifact hash. The materialization receipt records each destination digest with its basis and record digest. Records bind exact bytes and the route-set digest; edited content or changed routes return a document to `pending`.

Records live in host-private `.lervo/state/knowledge/document-route-classifications.json`, bounded to 4,096 records and pruned to those a current plan relies on or awaits. They are evidence, not canonical state. Each host's resident may classify; enabled moves are published like other lifecycle changes. With Hub coordination, the single convergence owner from [ADR-0466](../../coordination/sync/0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md) still applies, so Mac and WSL behave the same way.

## Failure and privacy

This decision adds no event type. It removes the `unclassified_document`, `ambiguous_document_route`, `unclassified_decision`, and `ambiguous_decision_route` blockers. The following plan fields, blocker, and advisory apply:

| Name | Kind | Required fields | Failure meaning |
| --- | --- | --- | --- |
| `deferredDocuments[]` | plan field | `classificationId`, `subject`, `path`, `contentHash`, `reason`, `workspacePackage` | None. The document awaits a semantic route and blocks nothing. |
| `unknown_document_role` | plan blocker | `code`, `path`, `candidateRouteIds` (the declared role) | Explicit `lervo.document.role` names no catalog role. |
| `retainedDocuments[]` | plan field | `path`, `basis`, and `evidence` or `semanticClassification` | None. The document remains in place for the recorded reason. |
| `document_route_classification_deferred` | lifecycle advisory | `code`, `command`, `detail` (`<path>: <reason>`) | Agent-owned attention; never a lifecycle gate. |

Provider requests carry only the route catalog and each document's path, workspace package, content hash, and an excerpt of at most 8 KiB. Content is marked untrusted. Records and plans hold paths, hashes, outcomes, and a rationale of at most 1,024 characters, never document bodies. Provider unavailability, a paused provider, or a missing delegation leaves documents `pending`; it never routes or blocks them.

## Verification

Focused tests must show:

- Flemo-like `apps/web/app/[lang]/docs/_data/**` content loaded by its package through joined path arguments is retained with `source_reference` evidence, without blocking the upgrade knowledge stage.
- A document whose title matches no route defers with `semantic_classification_pending`, blocks neither the layout plan nor `lervo upgrade`, and appears as an attention advisory.
- A legacy layout title term matching a heading no longer places the document. Only a recorded classification does, and the layout is rewritten with descriptions.
- Explicit metadata routes application content; `retain_in_place` and `uncertain` never route; changed bytes return a document to `pending`.
- Root role documents move only through explicit role metadata, a declared legacy alias, or a recorded semantic role. Stems and headings alone leave them deferred; a semantic role with an occupied destination also defers.
- Markdown that merely resembles a handoff is neither a continuation candidate nor assigned the handoff profile.
- The resident classifies only in-scope pending documents, records evidence, and never queries uncertain bytes again.
