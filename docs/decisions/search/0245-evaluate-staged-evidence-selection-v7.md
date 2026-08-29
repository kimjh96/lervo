# ADR-0245: Evaluate staged evidence selection v7

Status: `accepted`

## Context

Marker-derived v6 preserved exact observable output references but was rejected for source-selection quality. The assisted arm passed 13/24 grounded-answer verdicts, passed all repetitions for three cases, reached 64.58% exact expected-path recall, omitted relevant supplied sources, and skipped the no-hit candidate step in three turns.

V6 combined evidence selection and answer composition in one provider turn. A missing final marker was therefore ambiguous: the source might not have been selected, or it might have been selected without an output reference. The next bounded candidate should separate these observable transitions without asserting unobservable attention or internal use.

## Decision

Pre-register `staged-evidence-selection-v7` with the same human-reviewed eight cases, expected paths, lexical-v1 recommendations, deterministic core-and-term coverage, no-hit catalog scope, three repetitions, rotating arm order, thresholds, and contemporaneous model-direct comparison as v6.

Run the assisted arm as two independent read-only provider turns. Stage one receives the v6 evidence bundle. For lexical hits, it may return only exact `lervo-e4` comments for selected supplied bodies. For lexical no-hits, it receives only a bounded path-title catalog with opaque selection tokens and may return one to four exact tokens. Prose, JSON, invented tokens, duplicates, and out-of-scope coordinates fail the selection contract.

The harness resolves recognized stage-one coordinates, loads only those repository bodies, and injects them into stage two. Stage two returns bounded Korean prose plus exact `lervo-e4` comments for bodies directly supporting its answer. Returned source paths derive only from those final exact references.

Selection, harness loading and injection, and final output reference are separate observations. None proves provider attention, semantic reliance, understanding, agreement, correctness, completeness, or internal use.

Retain every v6 quality and resource threshold, and add a zero threshold for selection-contract failures. V7 token and duration totals include both stages. A failed stage-one contract prevents stage two and produces an incomplete usage observation, which cannot satisfy resource acceptance. Any failed criterion rejects v7.

This decision authorizes evaluation only. `lexical-v1` remains operational unless a later reviewed decision explicitly changes production routing.

## Privacy and failure meaning

Queries, approved expected paths, protocol digests, opaque coordinate definitions, and aggregate observations may be checked in. Raw stage outputs and markers remain mode-`0600` operator output outside the repository. Tracked evidence excludes answer prose, source bodies, absolute paths, and provider turn identifiers.

`selection_contract_failed` means stage one emitted prose or JSON; returned malformed, duplicate, unknown, forbidden, or out-of-bound coordinates; or selected no source. `coverage_contract_failed` means the harness could not load every recognized selection, or a no-hit selection lacked a final output reference. `source_marker_contract_failed` means stage two emitted a malformed, unknown, or forbidden source marker. `response_contract_failed` means stage two violated the bounded prose-and-marker envelope. Provider failures and relevant-source preservation failures retain their existing meanings. None changes production routing.

## Consequences

The accepted repeated experiment rejected v7. It passed 16/24 grounded-answer verdicts versus 17/24 for model direct, passed every repetition for five cases in both arms, and reached 79.17% recall versus 83.33%. With complete usage and no provider execution failure in either arm, it used 40.79% of direct observed tokens and 53.48% of direct duration.

All 24 v7 selection stages satisfied the token-only contract, all selected coordinates loaded, and both no-hit cases passed every repetition with exact final references. Across 48 completed v7 provider turns, 46 final evidence references were recognized. V7 still failed repeatability, pass-count and recall non-inferiority, one source-marker and response contract, and two relevant deterministic coverage-source preservation checks.

The separation resolved v6's skipped no-hit inspection: observable selection, harness load and injection, and final output reference were present without claiming provider use. It did not repair the stable release-source or execution-specification omissions. `lexical-v1` remains operational. V7 is a negative evaluation baseline and is not authorized for production activation or provenance promotion. See the [redacted v7 observation](../../evidence/search/staged-evidence-v7.md).

## Verification

- Prove that v7 preserves v6's human-reviewed cases, expected paths, lexical expectations, and corpus, except for the required v7 self-exclusion.
- Test hit and no-hit selection parsing, exact token bounds, prose rejection, final exact-reference derivation, and separation of selection, loading, injection, and final-reference observations.
- Before provider execution, verify dry-run lexical expectations, deterministic coverage, the bounded no-hit catalog, and both stage digest bindings.
- Bind the repeated report to the suite, both stage protocols, corpus, repository snapshot, provider, model, privacy policy, repetitions, and exact acceptance criteria.
- Complete repository quality, tests, builds, documentation lifecycle, knowledge refresh, and release-completion checks.
