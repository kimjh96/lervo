# ADR-0273: Test the compatible structured provider-shadow carrier in v16

Status: `accepted`
Date: 2026-08-29

## Context

[V15](../../../../evidence/search/provider-shadow/linked-evidence-provider-shadow-pilot-v15.md) consumed one Codex call and stopped because its response-format schema used the unsupported `uniqueItems` keyword. [ADR-0272](0272-remove-unsupported-structured-selection-unique-items.md) removed that redundant generation constraint while retaining parser-side duplicate rejection. Focused carrier, contract, quality, and documentation checks passed without another experimental call.

V15 remains immutable and rejected. The correction requires fresh paired Codex and Claude evidence.

## Decision

Run one fresh paired v16 diagnostic on the same two v14-v15 cases and all four immutable nonempty repetitions. Use new `psv16_` coordinates and exactly eight calls per provider, 16 total.

Keep unchanged the request-scoped claim-coverage protocol, candidate envelopes and order, expected document IDs, thresholds, alternating provider order, failure diagnostics, privacy boundary, no-effect controls, timeout, and no-retry rule. Give both providers the same `structured_exact_e4_token_array` schema without `uniqueItems`; the strict parser continues to reject duplicates.

Each provider must independently achieve:

- 100% recall in every observation;
- at least 50% precision in every observation;
- at least 65% mean precision;
- no more than eight selections;
- complete duration and usage; and
- zero unavailable, grammar, replay, privacy, or primary-effect failures.

The cumulative v2-v16 authorization ceiling is 235 calls. A pass authorizes only a separately reviewed four-case confirmation design, not the confirmation itself, managed context, canary traffic, operational search, or activation. Any failure rejects v16 without retry, repair, replacement, or threshold change.

## Verification

- Bind the exact v7 base, v16 overlay, unchanged request-scoped protocol digest, two cases, four repetitions, and 16 attempts.
- Prove the schema omits `uniqueItems` while parser-side duplicate rejection remains active.
- Reconstruct identical paired requests and candidate envelopes without a provider.
- Preserve v10 candidate order, content hashes, byte counts, and expected document IDs.
- Reject stale authority, extra calls, retries, incomplete usage, and every existing fail-closed condition.
- Publish provider-specific recall, precision, duration, token use, selected bytes, cumulative history, and disposition.

## Outcome

V16 completed all 16 calls with compatible structured output and no unavailable, grammar, replay, privacy, or primary-effect failure. Claude passed with 100% recall and 79.17% mean precision. Codex achieved 100% precision but omitted one of two distinct fuzzy-merge relation sides in one repetition, resulting in 93.75% mean recall and 50% minimum recall. V16 is rejected without retry. See the [v16 evidence](../../../../evidence/search/provider-shadow/linked-evidence-provider-shadow-pilot-v16.md) and [ADR-0274](0274-test-relational-coverage-provider-shadow-v17.md).

## References

- [ADR-0272](0272-remove-unsupported-structured-selection-unique-items.md)
- [V15 evidence](../../../../evidence/search/provider-shadow/linked-evidence-provider-shadow-pilot-v15.md)
- [Exact v16 overlay](../../../../../benchmarks/search/linked-evidence-provider-shadow-pilot-v16.json)
