# ADR-0276: Confirm relational coverage in provider-shadow v18

Status: `accepted`
Date: 2026-08-29

## Context

[V17](../../../../evidence/search/provider-shadow/linked-evidence-provider-shadow-pilot-v17.md) passed its paired two-case diagnostic with 100% recall for Codex and Claude, passing precision, valid common structured output, complete usage, and unchanged primary effects. The provider-neutral relational rule repaired the observed fuzzy-merge omission, but two cases cannot establish behavior across the complete reviewed unambiguous set.

## Decision

Run one fresh paired v18 confirmation over the four reviewed unambiguous cases from v10 and v13: implementation release, terse release, hybrid-search rationale, and fuzzy merge. Use all four immutable nonempty repetitions, new `psv18_` coordinates, and exactly 16 calls per provider, 32 total.

Keep unchanged the v17 relational-coverage protocol, common structured carrier, candidate bodies and order, expected document IDs, ambiguity exclusions, thresholds, maximum selections, alternating provider order, privacy and no-effect controls, failure handling, timeout, and no-retry rule. The cumulative v2-v18 authorization ceiling is 283 calls.

Each provider must independently achieve 100% recall in every observation, at least 50% precision in every observation, at least 65% mean precision, no more than eight selections, complete duration and usage, and zero unavailable, replay, privacy, grammar, or primary-effect failures.

A pass authorizes only a separately reviewed managed-context canary and activation design based on cumulative history; it does not authorize the canary or activation. Any failure rejects v18 without retry, repair, replacement, reclassification, or threshold change.

## Outcome

V18 completed all 32 calls exactly once without retry. Codex and Claude each produced 16 valid observations with 100% minimum and mean recall, zero dropped relevant sources, complete usage, and zero unavailable, replay, privacy, grammar, or primary-effect failures. Codex achieved 93.75% mean precision and Claude 76.04%; both exceeded the unchanged 65% mean and 50% per-observation gates.

From the same 1,482,580 provider-visible bytes, Codex selected 31 sources and 154,577 body bytes, while Claude selected 40 sources and 199,152 body bytes. Codex completed in 193.063 seconds and Claude in 737.736 seconds.

The confirmation passed and permits a separate managed-context canary and activation design review. It does not activate any effect.

## Verification

- Bind the exact v7 base, v18 overlay, v17 relational protocol digest, four included cases, two excluded ambiguous cases, four repetitions, and 32 calls.
- Reconstruct identical paired requests and candidate envelopes without a provider before execution.
- Preserve v10 expected document IDs and exclude provider output from ground truth.
- Require the compatible common JSON Schema carrier and strict parser validation for both providers.
- Publish per-provider and per-case recall, precision, duration, usage, selected bytes, cumulative accounting, and disposition.

## References

- [ADR-0274](0274-test-relational-coverage-provider-shadow-v17.md)
- [V17 evidence](../../../../evidence/search/provider-shadow/linked-evidence-provider-shadow-pilot-v17.md)
- [V18 evidence](../../../../evidence/search/provider-shadow/linked-evidence-provider-shadow-pilot-v18.md)
- [Exact v18 overlay](../../../../../benchmarks/search/linked-evidence-provider-shadow-pilot-v18.json)
