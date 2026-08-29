# ADR-0266: Confirm claim coverage over four cases in v12

Status: `accepted`
Date: 2026-08-29

## Context

[V11](../../../evidence/search/linked-evidence-provider-shadow-pilot-v11.md) applied a provider-neutral claim-coverage-before-minimization protocol to the two cases responsible for the v10 Codex recall failure. Codex and Claude both achieved 100% recall while remaining above the unchanged mean and per-observation precision gates.

V11 omitted the already-passing `implementation_release` and `rationale_hybrid_search` cases. Because the correction increased selections on terse release, the full reviewed population requires confirmation for precision or recall regressions before considering any canary design.

## Decision

Run one fresh paired v12 confirmation on the four reviewed unambiguous v10 cases:

- `drv8case_implementation_release`;
- `drv8case_terse_release`;
- `drv8case_rationale_hybrid_search`; and
- `drv8case_boundary_fuzzy_merge`.

Use all four immutable nonempty phase-A repetitions per case, producing 16 source samples, 16 Codex calls, and 16 Claude calls. Preserve the exact v11 claim-coverage protocol, v10 candidate envelopes and expected document IDs, native exact-token carrier, alternating provider order, thresholds, privacy, replay, and no-effect boundaries. Use fresh `psv12_` coordinates and no retry, replacement, repair, answer, or publication turn. The cumulative v2-v12 authorization ceiling is 155 calls.

Keep the two ambiguous cases excluded from both numerator and denominator without reclassification. Provider output cannot change ground truth, and expected paths remain hidden.

Each provider must independently achieve, in every observation, 100% reviewed expected-path recall and at least 50% precision; it must also achieve at least 65% mean precision, select at most eight sources, provide complete duration and usage, and have zero existing failure counts.

Passing authorizes only a separate managed-context canary design review. It does not authorize managed-context changes, canary traffic, direct-terminal changes, operational search, or production activation. Failure rejects v12 without retry or threshold change.

## Evidence and failure meaning

V12 preserves every predecessor and stores only bounded owner-only candidate, attempt, observation, duration, usage, selection, and no-effect evidence. It excludes raw prompts, provider output, source bodies, paths, credentials, billed costs, and unrestricted errors.

A pass confirms the protocol only on the four reviewed unambiguous cases. It does not establish correctness for the two excluded ambiguous cases, provider understanding, downstream answer quality, managed delivery, or production suitability.

## Verification

- Bind the exact v7 base, v12 overlay, v11 protocol digest, four included cases, two exclusions, four repetitions, and 32 attempts.
- Reconstruct every source sample without a provider and prove identical within-pair requests and candidate envelopes.
- Preserve v10 candidate order, content hashes, byte counts, and expected document IDs.
- Reject stale authority, extra calls, retries, altered ground truth, incomplete usage, and every existing fail-closed condition.
- Publish provider-specific accuracy, duration, token use, selected bytes, exclusions, and activation disposition.

## References

- [V11 evidence](../../../evidence/search/linked-evidence-provider-shadow-pilot-v11.md)
- [ADR-0265](0265-test-claim-coverage-before-minimization-v11.md)
- [Exact v12 overlay](../../../../benchmarks/search/linked-evidence-provider-shadow-pilot-v12.json)
