# ADR-0258: Correct Claude structured selection for provider-shadow v5

Status: `accepted`
Date: 2026-08-29

## Context

[Provider-shadow v4](../../../evidence/search/linked-evidence-provider-shadow-pilot-v4.md) proved Claude could complete the bounded read-only turn and report provider-neutral usage, but its first result failed the standalone E4-comment grammar. Because the pilot retained only a result digest and bounded failure code, the exact prose or marker-shape violation is unavailable.

The installed Claude Agent SDK supports a per-session JSON Schema output format and exposes the validated value as `structured_output` on a successful result. The adapter did not expose or capture this capability.

## Decision

Add an optional structured-output schema at the Claude adapter boundary. Pass it to the SDK as `outputFormat: { type: "json_schema", schema }`. Only when explicitly configured, capture a successful result's `structured_output` as JSON instead of its prose `result`. Fail closed if the requested structured output is absent or cannot be serialized. Leave existing unstructured Claude sessions unchanged.

After capture, keep the experiment contract provider-neutral. Generate a closed schema containing only exact candidate E4 tokens, with at most eight unique selections and no additional fields. The common parser accepts exactly `{ "evidenceTokens": [...] }`, rejects unknown or duplicate tokens, and maps valid tokens to canonical document IDs and content hashes. Do not loosen the legacy standalone-comment parser.

Run a fresh, fail-first Claude-only v5 micro-pilot over three distinct reviewed cases using fresh `psv5_` coordinates. Permit at most three Claude Opus calls and no retries, replacements, tools, repair turns, answer turns, or managed effects. The cumulative v2-v5 ceiling is 54 calls. Preserve v2-v4 as terminal evidence; do not reuse their results or coordinates.

## Consequences and evidence boundary

A passing micro-pilot establishes only Claude structured-selection compatibility and authorizes a separately reviewed, fresh 24-by-24 Codex-Claude rerun. It neither provides nor substitutes for a cross-provider speed, accuracy, token, or cost comparison.

`provider_shadow_selection_invalid` means the captured structured value violated the exact provider-neutral token contract. `provider_protocol_failed` means a successful SDK turn lacked explicitly requested structured output. `error_max_structured_output_retries` remains a terminal provider failure; Lervo adds no retry.

The adapter result contains only the schema-validated token array. Pilot observations retain only its digest, byte count, selected opaque document IDs and content hashes, duration, and bounded usage. They do not retain provider prose, prompts, source bodies, costs, or model diagnostics.

## Verification

- Test SDK schema forwarding, structured-result capture, missing-result failure, schema generation, and strict parsing.
- Verify common Claude adapter behavior remains unchanged when no schema is configured.
- Prepare three provider-free attempts and bind the exact contract bytes to the current workstream.
- Execute once, stop at the first failure, and review all three observations against the existing accuracy and no-effect gates.
- Publish measured compatibility, accuracy, duration, token, and candidate-byte results without a billed-cost claim.
- Run quality, documentation, knowledge, full-repository, and task-base release-completion checks.

## References

- [ADR-0257: Observe Claude SDK usage for provider-shadow v4](0257-observe-claude-sdk-usage-provider-shadow-v4.md)
- [Provider-shadow v4 final report](../../../evidence/search/linked-evidence-provider-shadow-pilot-v4.md)
- [Exact v5 contract](../../../../benchmarks/search/linked-evidence-provider-shadow-pilot-v5.json)
