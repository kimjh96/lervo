# ADR-0269: Test request-scoped claim coverage in v14

Status: `accepted`
Date: 2026-08-29

## Context

[V13](../../../evidence/search/provider-shadow/linked-evidence-provider-shadow-pilot-v13.md) completed all 32 fresh calls with 100% recall for both providers. Claude selected five sources in one release observation, producing 40% precision and failing the unchanged 50% minimum. The [bounded diagnosis](../../../evidence/search/provider-shadow/linked-evidence-provider-shadow-v13-redundancy-diagnosis.md) found the same issue in release and fuzzy-merge cases: the v11 protocol inventoried claims supported by supplied bodies before restricting them to the requested task phase.

The failure followed identical candidate delivery. Candidate generation, order, ground truth, output carrier, provider adapters, thresholds, and no-effect controls require no change.

## Decision

Run one fresh paired v14 diagnostic micro-pilot on `drv8case_implementation_release` and `drv8case_boundary_fuzzy_merge`, using all four immutable nonempty phase-A repetitions. This produces eight source samples and eight calls per provider, with new `psv14_` coordinates.

Replace only the selection protocol:

1. Derive the current task and phase from the request. Supplied bodies may support but cannot expand that scope.
2. Inventory only independently required claims, authority boundaries, prerequisites, and operational instructions necessary for the current phase.
3. Do not treat a cross-reference, downstream stage, roadmap item, or general repository procedure as required by itself.
4. Keep a referenced source eligible when its body directly supplies a distinct prerequisite or authority necessary for the current phase.
5. Apply the existing coverage-before-minimization rule after this scoped inventory.

Keep v10 candidate envelopes and expected document IDs, exact native token carriers, alternating provider order, the eight-source maximum, failure diagnostics, privacy, replay, and no-effect boundaries unchanged. Do not retry, replace, repair, answer, or publish through a provider turn. Preserve v13 as completed and rejected. The cumulative v2-v14 authorization ceiling is 203 provider calls.

Each provider must independently achieve:

- 100% reviewed expected-path recall in every observation;
- at least 50% precision in every observation;
- at least 65% mean precision;
- at most eight selections;
- complete duration and usage; and
- zero unavailable, grammar, replay, privacy, or primary-effect failures.

A pass authorizes only a separate four-case confirmation design review. It does not authorize that confirmation, managed context, canary traffic, operational search, or production activation. Any failure rejects v14 without retry or threshold change.

## Evidence and failure meaning

V14 stores only bounded, owner-only candidate, attempt, observation, duration, usage, selection, violation-code, and no-effect evidence. It excludes raw prompts, provider output, source bodies, paths, credentials, billed costs, and unrestricted errors.

A pass means only that request-scoped claim coverage met existing gates on the two diagnosed cases. It does not prove internal reasoning, provider understanding, downstream answer quality, or full-population suitability. A failure remains a bounded selection or execution observation and cannot alter ground truth or historical results.

## Verification

- Bind the exact v7 base, v14 overlay, request-scoped protocol digest, two cases, four repetitions, and 16 attempts.
- Reconstruct every source sample without a provider and prove identical paired request and candidate-envelope digests.
- Preserve v10 candidate order, content hashes, byte counts, and expected document IDs.
- Preserve ADR-0267 violation-code diagnostics and raw-output exclusion.
- Reject stale authority, altered ground truth, extra calls, retries, incomplete usage, and every existing fail-closed condition.
- Publish provider-specific recall, precision, duration, token use, selected bytes, cumulative history, and disposition.

## Outcome

[V14](../../../evidence/search/provider-shadow/linked-evidence-provider-shadow-pilot-v14.md) consumed all 16 authorized calls. Claude's eight valid observations passed the provider gates with 100% recall, 68.75% mean precision, and 50% minimum precision. Seven Codex observations were exact; the final Codex result included prose outside the exact-token carrier and was recorded unavailable with `provider_shadow_prose_present`. Recovery made no further calls and preserved eight invocations per provider. Under the fail-closed rule, v14 is rejected and authorizes no confirmation or activation.

## References

- [V13 diagnosis](../../../evidence/search/provider-shadow/linked-evidence-provider-shadow-v13-redundancy-diagnosis.md)
- [V13 evidence](../../../evidence/search/provider-shadow/linked-evidence-provider-shadow-pilot-v13.md)
- [ADR-0267](0267-retain-bounded-selection-violation-codes.md)
- [Exact v14 overlay](../../../../benchmarks/search/linked-evidence-provider-shadow-pilot-v14.json)
