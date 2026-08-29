# ADR-0246: Evaluate linked-evidence reconciliation v8

Status: `accepted`

## Context

Staged evidence v7 separated observable selection, harness loading, and final exact references, but achieved 16/24 grounded-answer verdicts and 79.17% recall, compared with 17/24 and 83.33% for model direct. Release cases repeatedly omitted `docs/distribution/cli-version-management.md`, despite direct links from existing lexical recommendations. Two other turns selected and loaded `docs/specifications/execution.md` but omitted its final exact reference.

Unbounded one-hop expansion from every injected body is not viable: read-only measurement found that shared core coverage alone would expose about 60 sources and 350 KiB per case. Expansion limited to lexical recommendations produced zero to 21 candidates and zero to 143,718 bytes before applying a fixed bound. In both release cases, ordinary relative Markdown links exposed the omitted canonical document without request-category, fixture, or expected-path routing.

## Decision

Pre-register `linked-evidence-reconciliation-v8` using v7's human-reviewed eight cases, expected paths, lexical-v1 recommendations, deterministic coverage, no-hit catalog behavior, three repetitions, rotating arm order, and contemporaneous model-direct comparison.

For lexical-hit cases only, resolve repository-relative inline Markdown links directly present in the three ordered lexical recommendations. Ignore external, absolute, fragment-only, malformed, out-of-corpus, excluded, and already injected targets. Deduplicate by target path and retain a deterministic prefix in recommendation and link-occurrence order, stopping before exceeding eight linked sources or 65,536 linked-source bytes. Do not recurse. Inject retained linked bodies with the original recommendations and unchanged deterministic coverage into stage one.

For lexical-hit cases, require the final exact `lervo-e4` reference path set to equal the recognized stage-one selection path set. The harness loads only recognized selections. This observable reconciliation contract does not prove attention, semantic reliance, understanding, agreement, correctness, completeness, or internal use. Lexical no-hit selection, loading, answer protocol, and the at-least-one-selected-final-reference rule remain exactly as in v7.

Retain all v7 quality, resource, latency, marker, provider-neutrality, and stage thresholds. Add zero thresholds for reconciliation-contract failures and dropped relevant linked sources. V8 token and duration totals include both provider stages. Any failed criterion rejects v8.

This decision authorizes evaluation only. `lexical-v1` remains operational unless a later reviewed decision explicitly changes production routing.

## Privacy and failure meaning

Queries, approved expected paths, link coordinates, protocol digests, and aggregate observations may be checked in. Raw provider outputs and markers remain mode-`0600` operator output outside the repository. Tracked evidence excludes answer prose, source bodies, absolute paths, and provider turn identifiers.

`linked_evidence_bound_failed` means deterministic expansion exceeded its registered source, byte, depth, ordering, or corpus boundary. `reconciliation_contract_failed` means a lexical-hit final exact reference set differed from the recognized selected-and-loaded path set. `relevant_linked_source_dropped` means an exposed linked source matching reviewed ground truth was absent from final exact references. V7 selection, coverage, marker, response, provider, and relevant-source failure meanings remain unchanged. None changes production routing.

## Consequences

The corrected repeated experiment rejected v8 on one criterion. V8 achieved 21/24 grounded-answer verdicts versus 16/24 direct, passed every repetition for seven cases versus four, reached 100% expected-path recall versus 79.17%, and preserved every relevant recommendation, linked, coverage, and no-hit source. All selection, coverage, reconciliation, source-marker, response, and v8 provider-execution contracts passed. The linked canonical CLI source and previously omitted execution specification were selected, loaded, and finally referenced in every applicable repetition.

One model-direct Node-fleet turn failed provider execution, leaving control usage at 23/24 while v8 usage was complete at 24/24. The observed token ratio was 56.92%, but the pre-registered token criterion requires complete usage in both arms and therefore failed. Every other quality, duration, no-hit latency, contract, and source-preservation criterion passed. V8 remains rejected and has no activation authority.

All three v8 answer failures involved the terse release case: exact reconciliation preserved selected ADR-0223 in addition to the two reviewed expected paths. This was observable overselection, not a missing source or contract failure. The result warrants one separately pre-registered exact confirmatory replication with a fresh control, without changing ground truth, protocol, bounds, scorer, thresholds, or failure meanings and without combining observations across runs. See the [redacted v8 observation](../../evidence/search/linked-evidence-reconciliation-v8.md).

The first provider run was discarded before adoption because the stage-two prompt said every supplied body rather than every selected repository evidence body. The provider referenced the harness protocol document in all 18 lexical-hit answers, although the ADR and scorer correctly excluded it from the selected-and-loaded repository set. The prompt was corrected to state that the protocol document is not repository evidence and must never be referenced. After the protocol and suite digests changed, the full comparison was rerun rather than reinterpreting discarded output.

## Verification

- Prove that v8 preserves v7's human-reviewed cases, expected paths, lexical expectations, corpus, coverage, and no-hit contract, except for required v8 self-exclusion.
- Test relative-link resolution; rejection of external and out-of-corpus links; deduplication; deterministic ordering; source and byte truncation; and non-recursion.
- Test exact hit selection-to-final-reference reconciliation independently from no-hit coverage.
- Before provider execution, verify dry-run lexical expectations, linked-source paths and byte bounds, deterministic coverage, the bounded no-hit catalog, and all protocol digest bindings.
- Bind the repeated report to the suite, stage protocols, link policy, corpus, repository snapshot, provider, model, privacy policy, repetitions, and exact acceptance criteria.
- Complete repository quality, tests, builds, documentation lifecycle, knowledge refresh, and release-completion checks.
