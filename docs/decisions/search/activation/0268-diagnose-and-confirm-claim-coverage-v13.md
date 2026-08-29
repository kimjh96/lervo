# ADR-0268: Diagnose and confirm claim coverage in v13

Status: `accepted`
Date: 2026-08-29

## Context

[V11](../../../evidence/search/linked-evidence-provider-shadow-pilot-v11.md) repaired two diagnosed Codex recall failures under the claim-coverage-before-minimization protocol. [V12](../../../evidence/search/provider-shadow/linked-evidence-provider-shadow-pilot-v12.md) stopped after 17 of 32 calls when a completed Codex turn violated the exact selection grammar. [ADR-0267](0267-retain-bounded-selection-violation-codes.md) makes future failures observable through seven parser-owned codes without retaining raw provider output.

V12 remains rejected and immutable. A new run cannot replace it or establish that its failure did not occur. A fresh diagnostic confirmation can test the complete reviewed population under the corrected observation boundary while preserving cumulative failure history.

## Decision

Run one fresh paired v13 diagnostic confirmation on the same four reviewed unambiguous cases:

- `drv8case_implementation_release`;
- `drv8case_terse_release`;
- `drv8case_rationale_hybrid_search`; and
- `drv8case_boundary_fuzzy_merge`.

Use all four immutable, nonempty phase-A repetitions per case: 16 source samples, 16 Codex calls, and 16 Claude calls. Use new `psv13_` coordinates. Preserve the exact v11 protocol, v10 candidate envelopes and expected document IDs, native exact-token carrier, alternating provider order, thresholds, privacy, replay, and no-effect boundaries. Do not retry, replace, repair, answer, or publish through a provider turn. The cumulative v2-v13 authorization ceiling is 187 calls.

Keep the two ambiguous cases excluded from numerator and denominator without reclassification. Provider output cannot change ground truth. Expected paths remain hidden.

Before observation construction, persist a nonempty, bounded `selectionViolationCodes` array for every selection failure, then stop the run. Exclude raw provider output. Under ADR-0267, other failures retain an empty array.

For every observation, each provider must independently achieve:

- 100% reviewed expected-path recall;
- at least 50% precision;
- at least 65% mean precision;
- at most eight selections;
- complete duration and usage; and
- zero unavailable, replay, privacy, or primary-effect failures.

A pass authorizes only a separate managed-context canary design review. Publication must disclose both the rejected v12 failure and the v13 result; v13 cannot overwrite or reclassify v12. Any failure rejects v13 without retry or threshold change.

## Evidence and failure meaning

V13 stores only bounded, owner-only candidate, attempt, observation, duration, usage, selection, violation-code, and no-effect evidence. It excludes raw prompts, provider output, source bodies, paths, credentials, billed costs, and unrestricted errors.

A complete pass confirms the protocol only for this fresh four-case population. It does not establish provider understanding, downstream answer quality, managed delivery, production suitability, or zero historical carrier failures. A classified selection failure identifies only the violated parser rule and does not authorize parser relaxation.

## Verification

- Bind the exact v7 base, v13 overlay, v11 protocol digest, four cases, two exclusions, four repetitions, and 32 attempts.
- Reconstruct every source sample without a provider and prove identical within-pair requests and candidate envelopes.
- Preserve v10 candidate order, content hashes, byte counts, and expected document IDs.
- Require ADR-0267 violation-code persistence and raw-output exclusion for unavailable selection results.
- Reject stale authority, extra calls, retries, altered ground truth, incomplete usage, and every existing fail-closed condition.
- Publish provider-specific accuracy, duration, token use, selected bytes, cumulative failure history, and activation disposition.

## References

- [V12 evidence](../../../evidence/search/provider-shadow/linked-evidence-provider-shadow-pilot-v12.md)
- [ADR-0267](0267-retain-bounded-selection-violation-codes.md)
- [Exact v13 overlay](../../../../benchmarks/search/linked-evidence-provider-shadow-pilot-v13.json)
