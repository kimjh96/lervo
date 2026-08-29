# ADR-0274: Test relational coverage in provider-shadow v17

Status: `accepted`
Date: 2026-08-29

## Context

[V16](../../../../evidence/search/provider-shadow/linked-evidence-provider-shadow-pilot-v16.md) completed all 16 compatible structured-carrier calls. Claude passed every provider gate. Codex returned valid structured output in all eight calls and selected no unexpected source, but one fuzzy-merge repetition retained the later approval decision while omitting the distinct conflict-resolution prerequisite. Its 50% minimum recall failed the unchanged 100% gate.

The failure occurred in post-delivery selection. Candidate identity, order, content, ground truth, schema compatibility, parsing, usage, and primary-effect controls remained valid. V16 is immutable and rejected.

## Decision

Add this provider-neutral rule to the request-scoped claim-coverage protocol: when a request compares, reconciles, merges, or resolves a conflict between distinct records, constraints, or authorities, each side remains independently required unless the supplied bodies explicitly establish equivalence or full subsumption. A later approval or procedure does not alone replace the prerequisite or authority that validates it.

Run one fresh paired v17 diagnostic using the same two cases and four repetitions with new `psv17_` coordinates. Keep unchanged the candidate envelopes and order, expected document IDs, structured carrier, thresholds, maximum selections, alternating order, privacy and no-effect controls, failure handling, timeout, and no-retry behavior. Authorize exactly eight calls per provider, 16 total, raising the cumulative v2-v17 ceiling to 251.

Each provider must independently achieve:

- 100% recall in every observation;
- at least 50% precision in every observation;
- at least 65% mean precision;
- no more than eight selections;
- complete duration and usage; and
- zero unavailable, replay, privacy, grammar, or primary-effect failures.

A pass authorizes only a separately reviewed, fresh four-case confirmation—not managed context, canary traffic, operational search, or activation. Any failure rejects v17 without retry, repair, replacement, or threshold change.

## Verification

- Bind the exact v7 base, v17 overlay, relational protocol digest, two cases, four repetitions, and 16 calls.
- Prove paired requests and candidate envelopes match within each source sample and preserve v10 ground truth.
- Confirm that the rule is provider-neutral and exposes no expected document identifier, path, or case-specific route.
- Preserve the common JSON Schema carrier and strict parser-side duplicate rejection.
- Publish provider recall, precision, duration, usage, selected bytes, cumulative accounting, and disposition.

## Outcome

V17 completed all 16 calls without retry and without unavailable, grammar, replay, privacy, or primary-effect failures. Both providers retained 100% recall in every observation. Codex achieved 95.83% mean precision and Claude 79.17%; both had 66.67% minimum precision.

The diagnostic passed and authorizes only the separately reviewed four-case confirmation in [ADR-0276](0276-confirm-relational-coverage-provider-shadow-v18.md). See the [v17 evidence](../../../../evidence/search/provider-shadow/linked-evidence-provider-shadow-pilot-v17.md).

## References

- [ADR-0273](0273-test-compatible-structured-provider-shadow-carrier-v16.md)
- [Exact v17 overlay](../../../../../benchmarks/search/linked-evidence-provider-shadow-pilot-v17.json)
- [Combined measurement report](../../../../evidence/search/codex-claude-linked-evidence-measurement-report.md)
- [V17 evidence](../../../../evidence/search/provider-shadow/linked-evidence-provider-shadow-pilot-v17.md)
