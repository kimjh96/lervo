# ADR-0354: Enforce scope-complete resource and terminal budgets

- Status: `accepted`
- Decision date: 2026-09-03

## Context

The governed-loop resource projection listed root and retry attempts correctly but incorrectly used that narrow attempt set as its accounting boundary. Causally linked subagent and evaluation runs could be omitted. Because the group coordinate lacked resource scope, observations with the same provider, source, mode, and descriptor could be combined across primary and child work. A started managed child without a final resource observation did not make an otherwise observed group incomplete.

The terminal path recorded bounded hook stages and separately exposed query-projection usage, but no versioned command applied the accepted latency budgets to recent observations. Comparing one hook duration with a p95 threshold would misuse that threshold, while combining environments would produce misleading results.

## Decision

Keep attempt and resource projection separate. Only root and retry causal records are governed attempts. Resource projection traverses every recorded run in their complete causal work trees. The execution contract defines one provider-neutral mapping from causal relationship to resource scope. Provider-reported observations must match the exact causal work, adapter provider, and derived scope.

Key resource groups by provider, scope, source, accounting mode, and accounting descriptor. A started adapter run without one final provider-reported observation makes every otherwise matching provider-and-scope group partial with `resource_observation_missing`. If no matching group exists, admission fails closed because the configured limit lacks an exact observation.

Add resource scope to the governed application observation so token limits can bind it explicitly. The CLI accepts `<provider>:<scope>:<accounting-descriptor-hash>:<tokens>`. The previous unscoped form remains a compatibility input but succeeds only when exactly one provider-and-descriptor group exists. Multiple scopes are `resource_unobservable` and must never be summed.

Add the version-1 unmanaged-terminal budget policy and report, plus `lervo terminal budget`. The pure diagnostics projector groups successful hook totals by provider, hook, environment-profile digest, repository profile, and cold state. It applies the accepted 15-second prompt p95, 5-second Stop p95, and 30-second external ceiling. The default minimum is 30 samples; smaller populations are `unobservable`, not passing.

Operators may configure an exact per-context query-projection token threshold. The comparison remains per context because the terminal receipt has no accounting descriptor and cannot support a cumulative accounting group.

The command succeeds only for `passed`. Exhausted evidence defaults to `blocked`. Missing, invalid, incomplete, or insufficient evidence defaults to `escalation_required`. Policy may choose blocking or escalation for either class without changing the evidence meaning.

## Privacy and failure meaning

The report contains only existing opaque context coordinates, provider identifiers, environment digests, repository profile classes, cold states, durations, normalized token counts, limits, and reason codes. It contains no prompt, output, document body, path, credential, native provider response, price, or invoice.

Direct terminal whole-task usage remains `unsupported` with `unmanaged_provider_usage_unobserved`. A query-projection comparison proves only the receipt's per-context normalized count. A p95 decision proves only the grouped observed population; it does not establish provider latency, model quality, billed usage, or a guarantee for the next hook.

## Consequences

Governed admission can no longer silently omit a causally linked managed provider run or mix primary and child scopes. Existing unscoped policies remain readable but fail closed when a newly visible scope makes their coordinate ambiguous. Terminal performance budgets become machine-readable operational gates without weakening benchmark or evidence contracts.

This decision does not preempt a running provider call, observe unmanaged whole-task usage, infer a missing descriptor, combine environment profiles, or replace the reviewed provider-free benchmark.

## References

- [ADR-0334](0334-project-provider-resources-into-one-work-report.md)
- [ADR-0341](../../execution/orchestration/governed-work/0341-project-current-objective-and-observed-token-budgets.md)
- [Execution specification](../../../specifications/execution.md)
- [Foundation-hardening delivery tracks](../../../roadmap/foundation-hardening/delivery-tracks.md)
