# Resource and performance budgets

Status: `active`

As of: 2026-09-03

## Managed resource accounting

Governed attempt state includes only assignment-authorized root and retry runs. Resource accounting
for those attempts follows every recorded run in the same causal work tree, including subagent,
publication-evaluation, deliberation, and improvement-evaluation work. This separation keeps attempt
policy stable while preventing child provider work from disappearing from the resource report.

The execution contract derives the resource scope from the causal relationship. A
provider-reported observation must match its exact causal work ID, adapter provider, and derived
scope. Groups are exact to:

- provider;
- resource scope;
- source;
- accounting mode; and
- accounting descriptor hash.

No total crosses one of these boundaries. Every `adapter.started` run in the governed causal tree
must have one final provider-reported resource observation. A missing observation makes an otherwise
matching provider-and-scope group `partial` with `resource_observation_missing`. If no group exists,
admission finds no exact observation and fails closed as `resource_unobservable`.

Token limits should bind provider, scope, descriptor hash, and observed total. CLI input uses
`<provider>:<scope>:<descriptor-hash>:<tokens>`. The previous unscoped form remains readable for
compatibility, but it matches only when exactly one provider-and-descriptor group exists. Multiple
matching scopes remain ambiguous and are never selected, summed, or treated as zero.

A reached threshold prevents only the next governed attempt. It does not reserve future tokens,
preempt a running provider call, establish billed cost, or prove task correctness.

## Direct-terminal performance assessment

`lervo terminal budget` is a read-only diagnostic over the versioned terminal coverage report. It
does not create a managed run or upgrade direct provider work from `unmanaged`.

Successful `total` stage durations are grouped by provider, hook, environment-profile digest,
repository profile, and cold state. Profiles are never combined across those boundaries. The fixed
initial budgets are:

- prompt-preparation p95 at most 15 seconds;
- Stop p95 at most 5 seconds; and
- no valid observation reaching the 30-second external ceiling.

The default minimum population is 30. Operators may select a bounded population between 1 and 100
for a local assessment, but the report always records that policy. A profile below the selected
population is `unobservable`; missing, invalid, or incomplete stage evidence also fails closed. The
command exits successfully only when every required profile and configured query threshold passes.
Exhausted evidence defaults to `blocked`, while unobservable evidence defaults to
`escalation_required`; either policy disposition may be made stricter explicitly.

An optional `--max-query-tokens` threshold compares each exact query-projection receipt separately.
Because unmanaged terminal receipts lack an accounting descriptor, they cannot support a cumulative
query group. The report retains `per_context_usage_only` and never presents the result as whole-task
usage. Direct provider whole-task usage remains `unsupported` with
`unmanaged_provider_usage_unobserved`.

## Privacy and evidence limits

Budget reports contain opaque context event IDs, provider identifiers, environment digests,
repository profile classes, cold states, durations, normalized token counts, limits, dispositions,
and reason codes. They exclude prompts, outputs, reasoning, document bodies, paths, credentials,
native responses, prices, and invoices.

An observed counter proves only the declared normalized measurement. A p95 result proves only its
recorded population. Neither proves provider acceptance, model attention, correct learning, task
quality, billing, or the next invocation's behavior.

## References

- [Execution and evidence specification](../execution.md)
- [Stage observation and performance](stage-observation-and-performance.md)
- [ADR-0354](../../decisions/operations/trace/0354-enforce-scope-complete-resource-and-terminal-budgets.md)
