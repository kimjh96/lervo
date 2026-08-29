# Durable Claude structured-selection provider-shadow v6

Status: `stopped_rejected`
Date: 2026-08-29

## Result

V6 prepared three fresh Claude samples using cases excluded from v5 and stopped after the first accepted invocation. The completed turn produced the durable failure `provider_shadow_tool_activity`. All primary context, output, managed-write, verification, publication, and E1-E4 digests were unchanged. No retry, replacement, Codex call, canary action, or production action occurred.

The installed Claude Agent SDK represents JSON Schema output as an end-turn tool session: a successful tool-result carrier precedes the `structured_output` attachment containing the result. Although Lervo configured no ordinary tools, the experiment classified this provider-native carrier as ordinary tool activity and rejected the invocation before parsing its structured result.

V6 defines an exact compatibility boundary but provides no eligible accuracy, duration, token, cost, or compression measurement. It neither proves Claude performed repository inspection or command execution nor permits combination with prior Codex evidence.

## Evidence

- Provider invocations: 1 Claude and 0 Codex.
- Eligible observations: 0; unavailable observations: 1.
- Durable provider failure: `provider_shadow_tool_activity`.
- Privacy failures: 0.
- Primary-effect differences: 0.
- Prepared manifest: `sha256:c86bc18081b0f43d56cec3bd291c742f5cb1aa373c03ec04ffe7fdbabbf2feba`.

## Disposition

V6 is immutable and rejected. A successor may distinguish at most one provider-native structured-output framing event from operational tools only when the Claude adapter has no ordinary tools and the final structured result passes the exact schema and token parser. Commands and all additional tool activity remain fail-closed.

## References

- [Exact v6 contract](../../../benchmarks/search/linked-evidence-provider-shadow-pilot-v6.json)
- [ADR-0259](../../decisions/search/activation/0259-preserve-claude-selection-failure-provider-shadow-v6.md)
