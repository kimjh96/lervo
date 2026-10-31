# ADR-0540: Account for every document a migration defers

Status: `accepted`
Decision date: 2026-10-31
Amends: [ADR-0476](../0476-route-legacy-documents-semantically-and-never-migrate-application-content.md) (deferral and background classification)

## Context

[ADR-0476](../0476-route-legacy-documents-semantically-and-never-migrate-application-content.md) defers a legacy document that has no route metadata and no recorded classification. The background resident classifies it later, and the move goes through the lifecycle plan.

The owner reported that root documents such as `TRACE.md` are left out of migration. A reproduction on 2026-10-31 confirmed it:

- `lervo migrate knowledge` in a fresh repository with a root `TRACE.md` listed it in `deferredDocuments` as `semantic_classification_pending`, and the plan still reported `coverage.complete: true`.
- The foreground command never classifies. Its `--provider` option only drives content normalization.
- `classifyDeferredDocumentRoutes` classifies only paths within the delegation's `normalizationRoots`. Every observed delegation uses roots such as `docs`, `README.md`, and `AGENTS.md`, so a root `TRACE.md` is never classified.
- The lifecycle prefix refuses background moves outside the delegation's roots with `knowledge_authority_unavailable`, so even a classified root document could not move.

The deferral therefore never ends, and nothing says so. This is the "later never comes" failure the core outcomes reject.

## Decision

### Every candidate ends in a stated outcome

A migration plan accounts for every legacy document candidate with one outcome:

- `moved`: the plan moves it, with its route basis.
- `retained`: it stays in place with recorded evidence, as ADR-0476 defines.
- `deferred`: it awaits a route, with a `resolution` that names who resolves it and how.

`resolution` is one of:

- `background_classification`: the path is within the delegation's roots; the background resident classifies and moves it.
- `delegation_scope`: the path is outside the delegation's roots; the next delegation renewal proposes the exact paths, as below.
- `route_metadata`: classification returned `uncertain`; the document needs `lervo.document.route` or `lervo.document.role` metadata.
- `provider_unavailable`: no provider is admitted on this host to classify it.
- `destination_conflict`: the destination is occupied or selected by several candidates. The owner resolves the conflict and rebuilds the plan. Each source keeps its path, route basis, and intended destination in the deferral.

A plan with any deferred document reports `coverage.complete: false`. The text output starts with the deferred count and lists each path with its resolution.

### Classify during the command when a provider is given

`lervo migrate knowledge --provider <codex|claude>` classifies pending candidates before it builds the plan, through the same no-capability adapter, request bounds, and records as background classification. The command already runs a provider for normalization under the owner's invocation, so classification adds no new authority. Paused, capacity-limited, or rejected provider admission leaves the plan available with `provider_unavailable` deferrals. Records are host-private evidence, as ADR-0476 defines. The resulting moves appear in the same plan and follow its approval.

### Classify every deferred candidate in the background

Background classification no longer filters by `normalizationRoots`. Classification sends at most an 8 KiB excerpt to the delegated provider and writes only host-private records, so it is not a repository write. Moves stay bounded by the delegation's roots. Check every changed path before reading full bodies for provider review. This includes destinations and reference rewrites. An unauthorized atomic layout plan records its moves as `delegation_scope` deferrals and reaches neither review nor apply.

### Bring outside-root moves into the delegation once

When classified documents outside the delegation's roots would move, the next delegation renewal under [ADR-0469](../../../coordination/sync/0469-keep-background-knowledge-continuous-on-every-host.md) proposes adding exactly the missing file paths required by the complete move plan to `normalizationRoots`. The set includes sources, destinations, and reference rewrites outside the current roots. This is the existing scope-change owner decision. It carries all such paths at once, with the classification and destination of each, and recommends acceptance. After acceptance the background moves them through the lifecycle plan.

The proposal never adds a directory or a pattern, only exact file paths, including new destination files. Application content retained under ADR-0476 is never proposed. An unsatisfiable path reports `scope_path_unavailable` with `unsatisfiedPaths`. A proposal exceeding 32 normalization roots reports `normalization_root_limit`. The move remains deferred in either case; no partial or directory grant substitutes for the complete decision.

Record acceptance or decline through the existing private CAS receipt and materialization journal. The record binds the exact proposal, classification and changed-path evidence, and an artifact containing the owner's response. A declined identical proposal is not asked again, including a declined `normalization_root_limit` proposal. Re-propose only when the scope, required paths, or bound evidence changes. Acceptance still requires the exact reviewed delegation plan and its existing validation.

## State, events, privacy, and failure meaning

- No event type is added.
- `deferredDocuments[]` gains a required `resolution` field with the five values above. Classified conflicts and unauthorized moves also carry `basis` and `destination`; unauthorized moves carry the missing `requiredPaths`. Their reasons are `destination_conflict` and `delegation_scope`, respectively. Older plans without it are read as `background_classification`.
- The deferred count and the age of the oldest deferral are a Know measure for the core health projection (ADR-0535, open in PR #166), with actor `background classifier` for `background_classification` and `provider_unavailable`, and `principal proxy` for `delegation_scope`. `route_metadata` names the document and the metadata to add; Lervo adds it when the owner settles the route in conversation.
- Deferral history remains bounded at 4,096 current path hashes. `historyTruncated` marks lost history. The oldest age is unknown after truncation until a scan observes no remaining deferrals; a later scan must not invent first-seen times for surviving debt.
- Classification failures keep ADR-0476's meaning: the document stays `pending` and blocks nothing.

## Verification

Focused tests must show:

- a root `TRACE.md` is classified by `lervo migrate knowledge --provider` and moved in the same plan;
- without a provider, it is `deferred` with `provider_unavailable`, and the plan reports `coverage.complete: false`;
- background classification includes a path outside `normalizationRoots`, and the move is not attempted until the delegation includes the path;
- a renewal proposes exactly the classified outside-root file paths once, and never retained application content;
- conflicting sources each have one `destination_conflict` outcome with their route basis and intended destination;
- declined proposals, including root-limit proposals, stay settled until their evidence changes;
- a classified outside-root document becomes a `delegation_scope` deferral, an accepted exact decision grants every required path, and the lifecycle moves it;
- overflow beyond 4,096 observations reports unknown age even after retained observations resolve;
- every candidate in a plan has exactly one outcome, checked during planning.

Installed verification must show a fresh repository with a root `TRACE.md` ending with the file moved or with a stated resolution, never silently pending.
