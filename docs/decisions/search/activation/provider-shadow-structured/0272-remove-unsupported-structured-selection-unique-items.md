# ADR-0272: Remove unsupported structured-selection `uniqueItems`

Status: `accepted`
Date: 2026-08-29

## Context

[V15](../../../../evidence/search/provider-shadow/linked-evidence-provider-shadow-pilot-v15.md) stopped after Codex accepted its first turn and then rejected the response-format schema before producing an agent message. Privacy-bounded owner-local diagnostics identified the redundant `uniqueItems` keyword as the compatibility failure.

The common structured-selection schema also constrains tokens with an exact enum and a maximum item count. Independently, the provider-neutral result parser rejects repeated tokens with `duplicate_e4_marker`; generation-time uniqueness is not authoritative for observed-result validity.

## Decision

Remove only `uniqueItems` from `createProviderShadowV2StructuredSelectionSchema`. Keep the exact token enum, object shape, required `evidenceTokens` property, maximum selection count, and `additionalProperties: false` unchanged.

Retain parser-side duplicate rejection for both providers and every structured carrier. Add regression coverage proving that the generated schema omits `uniqueItems` and that a repeated token still fails with `duplicate_e4_marker`.

This decision authorizes only implementation and provider-free verification. It does not resume v15 or authorize a successor provider call, managed context, canary traffic, operational search, or activation.

## Consequences

Codex no longer receives a response-format keyword rejected by its upstream schema subset. Claude receives the same reduced schema. Duplicate output remains invalid at the canonical observation boundary, so telemetry claims do not weaken.

The change does not prove that a future Codex turn will complete; fresh evidence under a separately reviewed contract is required.

## Verification

- Assert that the generated schema contains the exact enum and maximum item count but no `uniqueItems`.
- Assert that duplicate structured tokens still produce `duplicate_e4_marker`.
- Preserve historical contract digests and v15 terminal state.
- Run focused carrier tests, quality, documentation, knowledge, and release completion checks without an experimental provider call.

## References

- [V15 evidence](../../../../evidence/search/provider-shadow/linked-evidence-provider-shadow-pilot-v15.md)
- [ADR-0270](0270-enforce-structured-codex-provider-shadow-carriers.md)
