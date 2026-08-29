# ADR-0270: Enforce structured Codex provider-shadow carriers

Status: `accepted`
Date: 2026-08-29

## Context

[V14](../../../../evidence/search/provider-shadow/linked-evidence-provider-shadow-pilot-v14.md) rejected its final Codex observation with `provider_shadow_prose_present`. The [bounded diagnosis](../../../../evidence/search/provider-shadow/linked-evidence-provider-shadow-v14-codex-carrier-diagnosis.md) found that Claude used a provider-native JSON Schema while Codex relied on prompt-only standalone comments. The strict common parser behaved as designed.

The installed Codex app-server protocol supports optional `turn/start.outputSchema`, but the Lervo Codex adapter does not expose or forward it. Changing the parser or retrying v14 would weaken or violate the pre-registered evidence contract.

## Decision

Add an opt-in `structuredOutputSchema` option to the Codex adapter. Forward a cloned schema to the app-server as `turn/start.outputSchema`. Omit the field from every unconfigured turn, preserving existing managed and direct behavior.

Pass a requested provider-shadow structured schema through the runner to both adapters. A future contract may select `structured_exact_e4_token_array`, mapping Codex and Claude to the same object with one bounded `evidenceTokens` array. Continue normalizing and validating the array through the provider-neutral selection parser.

Do not change `provider_native_exact_e4_token_set`: v9-v14 must continue to replay with standalone comments for Codex and JSON Schema for Claude. Do not alter selection instructions, candidates, expected paths, thresholds, violation meanings, privacy, or no-effect controls.

This decision authorizes implementation and tests only. It authorizes no provider invocation, v15 coordinates, confirmation, managed-context change, canary traffic, operational search, or production activation. Any successor measurement requires a separate reviewed decision and explicit call budget.

## Evidence, privacy, and failure meaning

The adapter option and app-server request contain only the caller-supplied JSON Schema. Provider output remains outside events and provider-shadow durable state. Existing bounded result digests, byte counts, token selections, violation codes, and usage retain their meanings.

Schema acceptance means only that the provider boundary accepted a constrained result shape. It does not prove correct token selection, recall, precision, understanding, or use. Schema rejection, invalid JSON, unknown or duplicate tokens, excessive selections, incomplete usage, tool activity beyond the contract, or binding mismatch remains fail-closed under existing codes.

This change adds no event or durable state. Its only new adapter state is immutable per-session configuration held in memory and discarded when the adapter stops.

## Verification

- Test the Codex stdio request with an exact `outputSchema` and reject a missing fixture field.
- Test adapter forwarding without changing the common adapter contract.
- Test that future structured provider-shadow configuration supplies the same exact schema to Codex and Claude.
- Retain the historical native-carrier differential test.
- Run Codex adapter, provider-shadow, quality, documentation, knowledge, full repository, and base-bound release-completion checks.

## References

- [ADR-0269](../0269-test-request-scoped-claim-coverage-v14.md)
- [V14 diagnosis](../../../../evidence/search/provider-shadow/linked-evidence-provider-shadow-v14-codex-carrier-diagnosis.md)
- [Provider adapter specification](../../../../specifications/execution/provider-adapters.md)
