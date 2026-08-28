# ADR-0239: Unmanaged terminal grounding failure abstention

Status: `accepted`

## Context

Direct terminal `UserPromptSubmit` asks the current provider for a typed semantic grounding proposal. An invalid nested `references` item failed strict proposal validation, but the terminal runtime collapsed the adapter failure into exit code 2, which the provider treated as prompt blocking. Removing only the prompt hook left the paired `Stop` hook without a matching preparation observation.

An invalid proposal must not authorize any workflow, effect, capability, provider route, source selection, or repository write. However, because direct provider terminals are unmanaged, failure to produce a valid proposal must not make a safely ungrounded conversation unavailable.

## Decision

The provider adapter receives the complete exact-key response schema, including nested reference, protocol-coordinate, and provider-route shapes. Deterministic validation remains authoritative even when the provider follows the schema.

The production grounding adapter translates process, parsing, binding, and proposal-validation failures into the stable application failure `semantic_resolution_failed`. It must not expose the raw request, provider output, configuration, or unrestricted error. Managed execution and workforce planning continue to reject this failure.

Only unmanaged direct terminal preparation translates this stable adapter failure into the existing typed `abstain` status. The decision contains no workflow, effects, capabilities, providers, authority, source classes, subjects, or retrieval queries. Its only reason is `semantic_resolution_failed`. Candidate selection returns no publications, while bounded fallback context still directs the agent to repository instructions. The hook returns that context successfully instead of using a blocking exit.

Repository discovery, exact-hash loading, workstream validation, workspace isolation, durable event recording, and activation-receipt failures remain blocking. Unknown errors outside the grounding adapter are not translated into abstention.

The event remains `terminal.context.prepared`. Existing fields record `groundingStatus: abstain`, empty grounding coordinates, and reason `semantic_resolution_failed`; privacy handling is unchanged. This failure means only that the current provider did not produce a valid typed proposal and Lervo selected no semantic action or repository source. It does not mean the user request was invalid or that the provider received or used prepared context.

## Consequences

Malformed or unavailable provider grounding cannot authorize behavior and no longer makes unmanaged terminal chat unavailable. A matching preparation observation is created so the paired `Stop` hook can finish the turn normally. The fallback is observable and measurable without recording raw prompts or errors.

The provider process timeout must remain within the outer hook timeout. Schema guidance reduces invalid output but does not replace deterministic parsing or the abstention path.

## Verification

- Provider adapter input includes the complete nested response schema.
- Invalid nested provider output becomes stable adapter failure `semantic_resolution_failed`.
- Direct `UserPromptSubmit` returns bounded abstain context with exit code 0.
- Managed consumers receive the adapter failure, not a fabricated proposal.
- Unknown repository or evidence failures propagate and block.

## References

- [Typed semantic grounding](0237-typed-semantic-grounding-and-terminal-stage-evidence.md)
- [Execution and evidence specification](../../../specifications/execution.md)
- [Typed semantic grounding specification](../../../specifications/execution/semantic-grounding.md)
- [Fail-closed provider terminal integration](../providers/0196-fail-closed-provider-terminal-integration.md)
