# Resource and performance budgets

Status: `active`

As of: 2026-09-04

## Managed resource accounting

Governed attempt state includes only assignment-authorized root and retry runs. Resource accounting follows every recorded run in the same causal work tree, including subagent, publication-evaluation, deliberation, and improvement-evaluation work. This preserves attempt policy while including child provider work in resource reports.

The execution contract derives resource scope from the causal relationship. A provider-reported observation must match its exact causal work ID, adapter provider, and derived scope. Groups are exact to:

- provider;
- resource scope;
- source;
- accounting mode; and
- accounting descriptor hash.

Totals must not cross these boundaries. Every `adapter.started` run in the governed causal tree must have one final provider-reported resource observation. A missing observation makes an otherwise matching provider-and-scope group `partial` with `resource_observation_missing`. If no group exists, admission finds no exact observation and fails closed as `resource_unobservable`.

Token limits bind provider, scope, descriptor hash, and observed total. CLI input uses `<provider>:<scope>:<descriptor-hash>:<tokens>`. The previous unscoped form remains readable for compatibility but matches only when exactly one provider-and-descriptor group exists. Multiple matching scopes are ambiguous and must never be selected, summed, or treated as zero.

A reached threshold prevents only the next governed attempt. It does not reserve future tokens, preempt a running provider call, establish billed cost, or prove task correctness.

## Direct-terminal performance assessment

`lervo terminal budget` is a read-only diagnostic over the versioned terminal coverage report. It neither creates a managed run nor upgrades direct provider work from `unmanaged`.

Successful `total` stage durations are grouped by provider, hook, environment-profile digest, repository profile, and cold state. Profiles must not be combined across these boundaries. Initial budgets are:

- prompt-preparation p95 at most 15 seconds;
- Stop p95 at most 5 seconds; and
- no valid observation reaching the 30-second external ceiling.

The environment-profile digest includes a hook-build digest. A changed measured implementation starts a new population without deleting or relabeling older exhausted evidence. A fresh cohort remains `unobservable` until it reaches the unchanged minimum population.

The default minimum population is 30. Operators may select a bounded population from 1 through 100 for a local assessment, and the report always records that policy. A profile below the selected population is `unobservable`; missing, invalid, or incomplete stage evidence also fails closed. The command succeeds only when every required profile and configured query threshold passes. Exhausted evidence defaults to `blocked`; unobservable evidence defaults to `escalation_required`. Either disposition may be made explicitly stricter.

An optional `--max-query-tokens` threshold compares each exact query-projection receipt separately. Because unmanaged terminal receipts lack an accounting descriptor, they cannot support a cumulative query group. The report retains `per_context_usage_only` and never presents the result as whole-task usage. Direct provider whole-task usage remains `unsupported` with `unmanaged_provider_usage_unobserved`.

The managed Codex app-server adapter separately observes `thread/tokenUsage/updated` and normalizes its exact provider-turn coordinates. This does not make the direct hook's main turn observable: installed hook input has no usage counter, and Lervo does not join a separate app-server stream to an unmanaged hook session by identifier guesswork.

## Privacy and evidence limits

Budget reports contain opaque context event IDs, provider identifiers, environment digests, repository profile classes, cold states, durations, normalized token counts, limits, dispositions, and reason codes. They exclude prompts, outputs, reasoning, document bodies, paths, credentials, native responses, prices, and invoices.

An observed counter proves only the declared normalized measurement. A p95 result proves only its recorded population. Neither proves provider acceptance, model attention, correct learning, task quality, billing, or the next invocation's behavior.

## References

- [Execution and evidence specification](../execution.md)
- [Stage observation and performance](stage-observation-and-performance.md)
- [ADR-0354](../../decisions/operations/trace/0354-enforce-scope-complete-resource-and-terminal-budgets.md)
