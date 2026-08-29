# V14 Codex carrier diagnosis

Status: `complete`
Date: 2026-08-29

## Question

Why did the final Codex observation in v14 produce `provider_shadow_prose_present` after seven exact Codex observations, and what boundary can prevent recurrence without relaxing the parser, reading raw output, or making another provider call?

## Evidence

V14 retained only the bounded violation code, result digest, byte count, invocation count, adapter coordinates, and terminal status. It retained no raw provider output, so the diagnosis cannot identify the literal prose, reconstruct model reasoning, or attribute intent.

The executable contract has an asymmetric carrier:

- Claude receives the exact allowed token set as a provider-native JSON Schema; the common parser normalizes its structured result.
- Codex receives the same semantic selection instructions but must render standalone HTML comments from prompt instructions alone.
- The common parser removes exact standalone comments and correctly emits `provider_shadow_prose_present` for any nonempty remainder.

Seven exact Codex observations prove that the prompt-only carrier can succeed, not that it constrains every result. The eighth completed turn is the counterexample.

The installed Codex CLI 0.150.1 app-server protocol independently exposes optional `TurnStartParams.outputSchema`, described as constraining the final assistant message. Lervo's Codex app-server client and adapter did not expose or forward that field during v14. This check generated protocol metadata locally and made no provider turn.

## Finding

The diagnosed engineering cause is a generation-enforcement gap, not a parser defect or demonstrated selection-quality failure. V14 required a zero-prose exact carrier but structurally enforced it only for Claude. Codex compliance depended on instruction following while the downstream parser remained deliberately strict.

Raw-output exclusion prevents a stronger claim about what appeared or why. The bounded evidence supports only these conclusions:

1. The Codex turn completed and returned a result bound to the expected turn.
2. The result contained bytes outside exact standalone E4 comments.
3. The parser classified those bytes correctly under the pre-registered contract.
4. The Codex adapter omitted an available provider-native output-schema constraint.

## Correction boundary

Keep v14 immutable and rejected. Do not retry, repair, reclassify, or relax `provider_shadow_prose_present`.

Add opt-in JSON Schema forwarding behind the Codex adapter. Use the existing exact `evidenceTokens` array schema for both providers only in a future contract that explicitly selects the structured carrier. Preserve standalone-comment behavior for v9-v14 replay and all default Codex turns. Continue validating the normalized token set with the common parser because provider-native structure is an input constraint, not correctness evidence.

This correction authorizes no provider call, new coordinates, confirmation, managed-context change, canary, operational search, or production activation. A fresh paired measurement requires a separate reviewed contract.

## Verification

- Prove the Codex app-server wire request contains the exact opt-in `outputSchema`.
- Prove the Codex adapter forwards a cloned schema only when configured.
- Prove future structured provider-shadow turns request the same schema for Codex and Claude.
- Prove the historical provider-native carrier still selects standalone comments for Codex and JSON Schema for Claude.
- Preserve bounded violation codes, raw-output exclusion, thresholds, and no-effect controls.

## References

- [V14 evidence](linked-evidence-provider-shadow-pilot-v14.md)
- [ADR-0269](../../../decisions/search/activation/0269-test-request-scoped-claim-coverage-v14.md)
- [ADR-0270](../../../decisions/search/activation/provider-shadow-structured/0270-enforce-structured-codex-provider-shadow-carriers.md)
