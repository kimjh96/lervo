# Paired provider-shadow pilot v3

Status: `failed`
Observed: 2026-08-29

## Outcome

V3 stopped after its first Claude call under the pre-registered first-failure rule. The Claude turn had no missing durable coordinate or detected primary effect, but the adapter emitted no complete usage observation. Its immutable unavailable record carries `provider_shadow_usage_unavailable`. Codex received no v3 call. V3 is terminal, non-resumable, and ineligible for paired comparison.

The exact contract digest is `sha256:e877622dcb06c4b5963e0fd9ebb2e1e7b23067bf6353672bbfeea20b048556fc`. The prepared manifest digest is `sha256:f847a5ab59e8934dd42ed745e97ad33e5329573ad30e92db657405e0cd9cde46`. Before execution, the prepared schedule contained 24 source samples, 48 provider-specific attempts, 608 exact candidate bindings, and zero calls.

| Provider | Model | Calls | Observed | Unavailable | Failure |
| --- | --- | ---: | ---: | ---: | --- |
| Claude | `opus` | 1 | 0 | 1 | Missing provider-neutral usage observation |
| Codex | `gpt-5.6-sol` | 0 | 0 | 0 | Not called after first-failure stop |

The Claude observation preserved primary context, output, managed writes, verification, publication, and E1-E4 event digests. It exposed the same 14 candidates and 97,037 source-body bytes as the matching v2 pair. Accuracy, duration, tokens, and compression are unavailable because the strict observed union persists selection metrics only after complete usage. Zero values in the failed machine review are absence sentinels, not measurements.

V3 proves that removing Claude tools did not fill the usage boundary. It proves nothing about Claude accuracy or token efficiency. [ADR-0257](../../decisions/search/activation/0257-observe-claude-sdk-usage-provider-shadow-v4.md) corrects the adapter mapping and preserves this failed result.

## References

- [ADR-0256](../../decisions/search/activation/0256-correct-claude-provider-shadow-observability-v3.md)
- [Exact v3 contract](../../../benchmarks/search/linked-evidence-provider-shadow-pilot-v3.json)
- [Provider-shadow v2 evidence](linked-evidence-provider-shadow-pilot-v2.md)
