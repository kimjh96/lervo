# ADR-0271: Test the structured Codex provider-shadow carrier in v15

Status: `accepted`
Date: 2026-08-29

## Context

[V14](../../../../evidence/search/provider-shadow/linked-evidence-provider-shadow-pilot-v14.md) rejected the request-scoped diagnostic because the final Codex result contained prose outside the prompt-only standalone-token carrier. The [bounded diagnosis](../../../../evidence/search/provider-shadow/linked-evidence-provider-shadow-v14-codex-carrier-diagnosis.md) found that Claude received a provider-native JSON Schema while Codex did not, although the installed Codex app-server protocol supports `turn/start.outputSchema`. [ADR-0270](0270-enforce-structured-codex-provider-shadow-carriers.md) implemented and fully verified opt-in schema forwarding without a provider-shadow call.

Fresh paired evidence is required because immutable v14 cannot provide it.

## Decision

Run one fresh paired v15 diagnostic with the same two v14 cases and all four immutable nonempty repetitions. Use new `psv15_` coordinates and exactly eight calls per provider, 16 total.

Retain the v14 request-scoped claim-coverage protocol, candidate envelopes and order, expected document IDs, thresholds, alternating provider order, failure diagnostics, privacy boundary, no-effect controls, timeout, and no-retry rule. Change only the carrier to `structured_exact_e4_token_array`, supplying the same bounded `evidenceTokens` JSON Schema to Codex and Claude. Continue excluding raw provider output.

Each provider must independently achieve:

- 100% reviewed expected-path recall in every observation;
- at least 50% precision in every observation;
- at least 65% mean precision;
- at most eight selections;
- complete duration and usage; and
- zero unavailable, grammar, replay, privacy, or primary-effect failures.

The cumulative v2-v15 authorization ceiling is 219 calls. A pass authorizes only a separately reviewed four-case confirmation design, not that confirmation, managed context, canary traffic, operational search, or production activation. Any failure rejects v15 without retry, repair, replacement, or threshold change.

## Evidence and failure meaning

V15 stores only bounded, owner-only candidate, attempt, observation, duration, usage, selection, violation-code, and no-effect evidence. It excludes raw prompts, provider output, source bodies, paths, credentials, billed costs, and unrestricted errors.

A pass shows only that the schema-constrained carrier produced valid paired selection observations under the two-case gate. It does not prove internal reasoning, provider understanding, downstream answer quality, or full-population suitability. A failure remains a bounded execution or selection observation and cannot reclassify v14.

## Verification

- Bind the exact v7 base, v15 overlay, unchanged v14 protocol digest, two cases, four repetitions, and 16 attempts.
- Reconstruct every sample without a provider and prove identical paired request and candidate-envelope digests.
- Require `structured_exact_e4_token_array` for both providers and preserve the strict provider-neutral parser.
- Preserve v10 candidate order, content hashes, byte counts, and expected document IDs.
- Reject stale authority, extra calls, retries, incomplete usage, and every existing fail-closed condition.
- Publish provider-specific recall, precision, duration, token use, selected bytes, cumulative history, and disposition.

## References

- [ADR-0270](0270-enforce-structured-codex-provider-shadow-carriers.md)
- [V14 carrier diagnosis](../../../../evidence/search/provider-shadow/linked-evidence-provider-shadow-v14-codex-carrier-diagnosis.md)
- [Exact v15 overlay](../../../../../benchmarks/search/linked-evidence-provider-shadow-pilot-v15.json)

## Outcome

V15 consumed one Codex call and stopped. Codex accepted the turn but rejected `uniqueItems` in the response-format schema before producing an agent message. No Claude call occurred. Recovery made zero calls, materialized the first Codex observation as unavailable, and preserved the fail-first boundary. V15 is rejected; its remaining 15 attempts cannot run.
