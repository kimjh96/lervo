# ADR-0354: Enforce scope-complete resource and terminal budgets

- Status: `accepted`
- Decision date: 2026-09-03

## Context

The governed-loop resource projection listed root and retry attempts correctly, but it also used
that narrow attempt set as its accounting boundary. Causally linked subagent and evaluation runs
could therefore be absent from the governed report. Its group coordinate omitted resource scope,
so two observations with the same provider, source, mode, and descriptor could be combined across
primary and child work. A started managed child without a final resource observation did not lower
the completeness of an otherwise observed group.

The terminal path already recorded bounded hook stages and separately exposed query-projection
usage, but operators had no versioned command that applied the accepted latency budgets to recent
observations. Comparing one hook duration directly with a p95 threshold would give that threshold
the wrong statistical meaning, and combining different environments would make the result
misleading.

## Decision

Keep attempt projection and resource projection as separate concerns. Root and retry causal records
remain the only governed attempts, while resource projection traverses every recorded run in their
complete causal work trees. The execution contract owns one provider-neutral mapping from causal
relationship to resource scope. Provider-reported observations must match their exact causal work,
adapter provider, and derived scope.

Resource groups are keyed by provider, scope, source, accounting mode, and accounting descriptor.
A started adapter run without one final provider-reported observation makes every otherwise
matching provider-and-scope group partial with `resource_observation_missing`. When no matching
group exists, admission still fails closed because the configured limit has no exact observation.

Add resource scope to the governed application observation. Token limits may now bind it explicitly,
and the CLI accepts
`<provider>:<scope>:<accounting-descriptor-hash>:<tokens>`. The previous unscoped form remains a
compatibility input, but it succeeds only when exactly one provider-and-descriptor group exists;
multiple scopes are `resource_unobservable`, never summed.

Add the version-1 unmanaged-terminal budget policy and report plus
`lervo terminal budget`. The pure diagnostics projector groups successful hook totals by provider,
hook, environment-profile digest, repository profile, and cold state. It applies the accepted
15-second prompt p95, 5-second Stop p95, and 30-second external ceiling. The default minimum is 30
samples; smaller populations are `unobservable`, not passing. Operators may configure an exact
per-context query-projection token threshold. Such a comparison remains per context because the
terminal receipt has no accounting descriptor and cannot support a cumulative accounting group.

The command returns success only for `passed`. Exhausted evidence defaults to `blocked`; missing,
invalid, incomplete, or insufficient evidence defaults to `escalation_required`. Policy can choose
block or escalation for either class without changing evidence meaning.

## Privacy and failure meaning

The new report contains only existing opaque context coordinates, provider identifiers,
environment digests, repository profile classes, cold states, durations, normalized token counts,
limits, and reason codes. It contains no prompt, output, document body, path, credential, native
provider response, price, or invoice.

Direct terminal whole-task usage remains `unsupported` with
`unmanaged_provider_usage_unobserved`. A query-projection comparison proves only the receipt's
per-context normalized count. A p95 decision proves only the grouped observed population; it is not
provider latency, model quality, billed usage, or a guarantee about the next hook.

## Consequences

Governed admission can no longer silently omit a causally linked managed provider run or mix
primary and child scopes. Existing unscoped policies remain readable while naturally failing closed
when a newly visible scope makes their coordinate ambiguous. Terminal performance budgets become
machine-readable and usable as an operational gate without weakening the benchmark or evidence
contracts.

This decision does not preempt a running provider call, observe unmanaged whole-task usage, infer a
missing descriptor, combine environment profiles, or replace the reviewed provider-free benchmark.

## References

- [ADR-0334](0334-project-provider-resources-into-one-work-report.md)
- [ADR-0341](../../execution/orchestration/0341-project-current-objective-and-observed-token-budgets.md)
- [Execution specification](../../../specifications/execution.md)
- [Foundation-hardening delivery tracks](../../../roadmap/foundation-hardening/delivery-tracks.md)
