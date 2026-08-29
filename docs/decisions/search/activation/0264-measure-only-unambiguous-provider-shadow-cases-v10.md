# ADR-0264: Measure only unambiguous provider-shadow cases in v10

Status: `accepted`
Date: 2026-08-29

## Context

[Provider-shadow v9](../../../evidence/search/linked-evidence-provider-shadow-pilot-v9.md) completed six paired observations per provider, but two cases exposed plausible alternative sources whose reviewed expected paths cannot be revised from provider output. [ADR-0263](0263-require-blind-human-ground-truth-audit-after-v9.md) prepared a provider-blind human-review packet, but no eligible independent reviewer is available. Requiring that review would make the evaluation impossible to complete.

Four cases retain reviewed, unambiguous expected paths. The `terse_release` Codex omission remains a genuine failure under unchanged ground truth. Excluding ambiguous cases must not turn them into passes or change their expected paths.

## Decision

Remove completion of the ADR-0263 audit as a prerequisite for this activation path. Preserve its packet and awaiting-review status as immutable evidence. Exclude `drv8case_status_node_fleet` and `drv8case_boundary_user_owned_block` from both the numerator and denominator of the next measurement without reclassification.

Run one fresh paired v10 measurement over the other four reviewed cases:

- `drv8case_implementation_release`;
- `drv8case_terse_release`;
- `drv8case_rationale_hybrid_search`; and
- `drv8case_boundary_fuzzy_merge`.

Use all four immutable, nonempty phase-A repetitions for each case, yielding 16 source samples, 16 Codex calls, and 16 Claude calls. Use fresh `psv10_` coordinates, the unchanged v9 minimal-sufficiency protocol, identical within-pair candidate envelopes, alternating provider order, and no retry, replacement, repair, answer, or publication turn. Stop at the first unavailable or failed observation. The cumulative v2-v10 authorization ceiling is 107 provider calls.

Each provider must independently satisfy all unchanged gates:

- 100% reviewed expected-path recall per observation;
- at least 65% mean precision;
- at least 50% precision per observation;
- at most eight selections;
- complete duration and usage; and
- zero adapter, result, replay, privacy, relevant-source-drop, or primary-effect failures.

Passing authorizes only a separate managed-context canary design review. It does not authorize a managed-context change, direct-terminal change, canary traffic, or production activation. Failing rejects v10 without retry or threshold change.

## Evidence and failure meaning

V10 uses versioned candidate, attempt, and observation records in owner-only, deletable local state. They exclude raw provider output, prompts, source bodies, paths, credentials, billed costs, and unrestricted diagnostics. Selected, loaded, referenced, and used remain distinct; the measurement observes only provider-shadow selection.

An excluded case is `not_evaluated_ambiguous`, never correct, incorrect, or human-confirmed. The four-case result estimates only the reviewed unambiguous population, and every report must disclose that scope.

## Verification

- Bind the exact v7 base, v10 overlay, minimal-sufficiency protocol, four included cases, two excluded cases, four repetitions, and 32 attempts.
- Reconstruct every source sample provider-free and prove identical within-pair request and candidate-envelope digests.
- Reject overlap, omission, changed ground truth, stale authority, extra calls, incomplete usage, and every existing fail-closed provider-shadow condition.
- Publish provider-specific accuracy, duration, token use, selected bytes, exclusions, and activation disposition.
- Run focused tests, quality, documentation, knowledge, full-repository, and task-base release-completion checks.

## References

- [ADR-0262](0262-test-minimal-sufficient-paired-provider-selection-v9.md)
- [ADR-0263](0263-require-blind-human-ground-truth-audit-after-v9.md)
- [Exact v10 overlay](../../../../benchmarks/search/linked-evidence-provider-shadow-pilot-v10.json)
- [Combined Codex-Claude report](../../../evidence/search/codex-claude-linked-evidence-measurement-report.md)
