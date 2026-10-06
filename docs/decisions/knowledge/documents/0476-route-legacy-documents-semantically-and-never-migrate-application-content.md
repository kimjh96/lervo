# ADR-0476: Route legacy documents semantically and never migrate application content

Status: `accepted`
Decision date: 2026-10-06
Amends: [ADR-0199](../repository/0199-structured-workstream-continuation-state.md) (continuation discovery), [ADR-0192](../repository/0192-repository-scoped-decision-taxonomy.md) (route selection), [ADR-0193](../repository/0193-semantic-repository-and-agent-surface-migration.md) (document candidacy), [ADR-0222](../repository/0222-bounded-role-based-document-layout.md)

## Context

On WSL, in repository `flemo` with CLI 0.20.0 (main `9c4598e8`), `lervo upgrade` reported the knowledge stage as `blocked` with `unclassified_document` for four files: `apps/web/app/[lang]/docs/_data/writing-guide.md`, `.../writing-guide/korean.md`, `.../sentences.md`, and `.../vocabulary.md`. The flemo.dev web app renders these files. They are application content, not repository documentation.

Two rules in `document-layout.ts` caused the block:

- The candidacy check treated nearly every `.md` or `.mdx` file outside the canonical trees as a legacy document that the layout must move.
- Routing matched each route's `titleTerms` from `.lervo/knowledge/document-layout.yaml` against the file's base name and first heading. Flat ADRs used the same rule, and Claude rules used basename patterns. A document that matched no term blocked the whole upgrade.

The owner has said more than once that Lervo must not decide semantic questions with keyword or title-term rules, because keywords are too limited. Moving content that code loads by path also breaks the application.

## Decision

- **Candidacy comes from evidence.** Markdown that the repository's own code or build consumes is application content and never a migration candidate. The evidence must be observed and is reported per document in `retainedDocuments`:
  - `source_reference`: a module or configuration in the same workspace package references the file, its directory, or a content glob that admits its extension. Imports, static template prefixes, and adjacent path arguments count.
  - `source_tree_member`: the file lies in a directory tree that holds the package's own source modules.
  - A package manifest declares the package boundary. Tests, other packages, a bare package-root reference, and the layout's documentation root never count. [ADR-0473](0473-publish-knowledge-within-its-write-scope-and-never-rewrite-a-tool-generated-document.md) tool ownership also retains a document in place.
- **Routing is semantic.** Explicit `lervo.document.route`, `lervo.document.role`, or `lervo.decision.route` metadata is the owner's declaration and comes first, even for content a package loads. Next, an exact `legacyAliases` path the reviewed layout declares for a document role places that file in the role. Otherwise the only basis is a recorded classification from the no-capability provider adapter. The classification is bound to the document's subject, path, content hash, and route-set digest. It returns `route` with a configured route, `role` with a catalog role for a document, `retain_in_place`, or `uncertain`. A semantic role whose destination already exists is deferred, not blocked.
- **No keyword, title, or stem rule decides anything in the document and knowledge layers.** This decision removes every such rule:
  - title-term route matching for documents and flat ADRs;
  - basename and title-term routing for Claude rules, including the `notification`, `widget`, `bridge`, `supabase`, `entity`, `app-`, and `web-` name patterns and the `repository` fallback;
  - root role recognition from `*_VISION`, `*_ARCHITECTURE`, `*_EXECUTION_SPEC`, `*_ROADMAP`, and `V<n>_PLAN` stems plus heading words;
  - continuation discovery that scored file names, headings, and phrases. A continuation source is now only the declared `HANDOFF.md` alias, `lervo.workstream.continuation: true` front matter, or an exact `--continuation-source` selection;
  - the normalization handoff profile chosen from the same name and heading words. It now follows the same declaration.
- **Deferral, not blocking.** A candidate without metadata or a current classification is listed in `deferredDocuments` as `semantic_classification_pending` or `semantic_classification_uncertain`. It never blocks the plan or `lervo upgrade`. Each deferred document becomes a `document_route_classification_deferred` attention advisory and a line in the upgrade's knowledge stage. An ungrouped flat ADR becomes a lint warning.
- **Background classification.** In the convergence lifecycle prefix, the background resident classifies pending documents inside the delegation's normalization roots, at most eight per call. The call runs under the existing assignment, provider admission, call budget, and usage measurement. A missing, mismatched, or unknown-route answer is recorded as `uncertain`, so the same bytes are never asked about twice. The resulting moves still pass the exact lifecycle plan, its independent review, and apply.
- **Routes are described, not keyed.** Each route now carries a prose `description`, which is classifier context only. Existing `titleTerms` are still read so older layouts stay valid. Loading converts them into the description, and the next layout plan rewrites the layout as a Lervo-managed `describe_semantic_routes` update. CLI 0.20.0 and earlier reject a rewritten layout because they require `titleTerms`. Every host that shares a repository must therefore run a CLI that includes this decision before the rewrite lands.

## Determinism and audit

A plan is a pure function of the scanned bytes, the layout, and the recorded classifications. Each semantic move records `classificationId`, `recordDigest`, the provider, `requestDigest`, `responseDigest`, and the observation artifact hash. The materialization receipt records each destination digest with its basis and record digest. Because a record is bound to exact bytes and the route-set digest, edited content or changed routes return a document to `pending`.

Records live in host-private `.lervo/state/knowledge/document-route-classifications.json`. They are bounded to 4,096 records and pruned to those a current plan relies on or waits for. They are evidence, not canonical state. Each host's resident may classify, and the move it enables is published like any other lifecycle change. When a Hub coordinates hosts, the single convergence owner of [ADR-0466](../../coordination/sync/0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md) still applies, so Mac and WSL behave the same way.

## Failure and privacy

This decision adds no event type. It removes the `unclassified_document`, `ambiguous_document_route`, `unclassified_decision`, and `ambiguous_decision_route` blockers. It adds these plan fields and one advisory code:

| Name                                     | Kind               | Required fields                                                                    | Failure meaning                                                   |
| ---------------------------------------- | ------------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `deferredDocuments[]`                    | plan field         | `classificationId`, `subject`, `path`, `contentHash`, `reason`, `workspacePackage` | None. The document waits for a semantic route and blocks nothing. |
| `unknown_document_role`                  | plan blocker       | `code`, `path`, `candidateRouteIds` (the declared role)                            | Explicit `lervo.document.role` names no catalog role.             |
| `retainedDocuments[]`                    | plan field         | `path`, `basis`, and `evidence` or `semanticClassification`                        | None. The document stays where it is for the recorded reason.     |
| `document_route_classification_deferred` | lifecycle advisory | `code`, `command`, `detail` (`<path>: <reason>`)                                   | Agent-owned attention. It is never a lifecycle gate.              |

Provider requests carry only the route catalog and, for each document, the path, workspace package, content hash, and an excerpt of at most 8 KiB. The content is marked untrusted. Records and plans hold paths, hashes, outcomes, and a rationale of at most 1,024 characters, never document bodies. Provider unavailability, a paused provider, or a missing delegation leaves documents `pending`. It never routes or blocks them.

## Verification

Focused tests must show:

- Flemo-like `apps/web/app/[lang]/docs/_data/**` content that its package loads by joined path arguments is retained with `source_reference` evidence, and the upgrade knowledge stage is not blocked.
- A document whose title matches no route defers with `semantic_classification_pending`, blocks neither the layout plan nor `lervo upgrade`, and appears as an attention advisory.
- A legacy layout's title term that matches a heading no longer places the document. Only a recorded classification does, and the layout is rewritten with descriptions.
- Explicit metadata routes application content; `retain_in_place` and `uncertain` outcomes never route; changed bytes return a document to `pending`.
- Root role documents move only through explicit role metadata, a declared legacy alias, or a recorded semantic role; stems and headings alone leave them deferred, and a semantic role with an occupied destination defers.
- Markdown that only resembles a handoff is neither a continuation candidate nor given the handoff profile.
- The resident classifies only in-scope pending documents, records evidence, and never asks again about uncertain bytes.
