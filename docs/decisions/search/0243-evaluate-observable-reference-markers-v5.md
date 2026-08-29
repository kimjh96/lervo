# ADR-0243: Evaluate observable reference markers v5

Status: `accepted`

## Context

Deterministic core-and-term v4 improved recall, precision, duration, and no-hit stability, but was not repeatable and twice omitted a relevant exact-merge source whose body was supplied. Selection, loading, and delivery provided no observable provider reference.

The next candidate must add a separately observable reference contract without changing the pending-human-review ground truth, treating a marker as evidence of understanding or use, routing by question category, or silently changing production execution.

## Decision

Pre-register `reference-marker-assisted-v5`. Preserve v4's eight queries, exact expected paths, lexical results, deterministic core-and-term coverage, no-hit catalog, three repetitions, rotating arm order, thresholds, and contemporaneous model-direct comparison.

For every returned `sourcePaths` item backed by a supplied evidence body, require the provider to append that document's exact `lervo-e4` evidence token as a standalone Markdown HTML comment. Returned paths and observed markers must have a one-to-one relationship. Reject markers for the benchmark protocol or path-title catalog because neither is answer evidence. Sources discovered through read-only repository inspection remain observable through repository commands and returned paths because they were not injected and have no supplied evidence token.

A marker proves only that the exact supplied version was explicitly referenced in bounded provider output. It does not prove attention, semantic reliance, understanding, agreement, correctness, completeness, or internal use. Strip known markers before parsing and retaining operator-only answer content.

Keep v4's acceptance criteria and add zero thresholds for failed reference contracts and relevant returned injected sources lacking a marker. Any failed criterion rejects v5. This decision authorizes evaluation only, not production activation or provenance promotion.

## Privacy and failure meaning

Queries are checked-in public fixtures. Raw answers and markers remain mode-`0600` operator output outside the repository. Tracked reports exclude answers, markers, source bodies, and absolute paths; they retain only bounded counts, digests, metrics, and failure codes.

`reference_contract_failed` means returned supplied-source paths and exact observed evidence markers were not bijective, or a protocol/catalog marker was returned. `relevant_returned_source_unreferenced` means an exact expected path was both supplied and returned without its exact marker. Existing provider, coverage, and preservation failures retain their v4 meanings. None changes production routing.

## Consequences

The repeated experiment rejected the candidate. V5 passed 9/24 grounded-answer verdicts versus 14/24 for model direct and passed every repetition for only two cases. It produced five invalid provider results, which also failed the coverage and reference contracts, and dropped four relevant deterministic coverage sources. Token observations were incomplete. Although its valid results produced 44 exact evidence references with no marker/path mismatch or unreferenced relevant returned source, that observable output discipline did not repair answer recall or repeatability.

`lexical-v1` remains operational. V5 is retained as a negative baseline and is not authorized for production activation or provenance promotion. The result does not establish provider use or production quality; see the [redacted v5 observation](../../evidence/search/reference-marker-assisted-v5.md).

## Verification

- Suite validation must reject v4 ground-truth, corpus, coverage, threshold, protocol, and reference-contract drift.
- Focused tests must cover exact marker/path bijection and missing, unreturned, forbidden, and unknown markers, plus acceptance failure for an unreferenced relevant returned source.
- The repeated report must bind the suite, protocol, reference policy, coverage policy, corpus, repository snapshot, provider, model, repetitions, privacy, and exact pre-registered criteria.
- Repository quality, tests, builds, documentation lifecycle, knowledge refresh, and release-completion checks remain required.
