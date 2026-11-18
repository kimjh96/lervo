# Managed resource accounting

Attempt projections include only assignment-authorized root and retry runs. Resource accounting includes every recorded run in the same causal work tree, including subagent, publication-evaluation, deliberation, and improvement-evaluation work. This keeps attempt projections exact while reporting child provider work.

The execution contract derives resource scope from causal relationships. Each provider-reported observation must match its exact causal work ID, adapter provider, and derived scope. Accounting groups are exact to provider, resource scope, source, accounting mode, and accounting descriptor hash. Reported totals and descriptor-bound governed limits must not cross these boundaries.

Every `adapter.started` run in the governed causal tree must have one final provider-reported resource observation. A missing observation makes an otherwise matching provider-and-scope group `partial` with `resource_observation_missing`. If no group exists, admission finds no exact observation and fails closed as `resource_unobservable`.

A run that fails before its provider adapter starts may have an unavailable provider-report receipt without `adapter.started`. Pre-start failures are `contract_validation_failed`, `approval_required`, `repository_snapshot_failed`, and `provider_start_failed`, the codes of the phases before `adapter_start`. The projector accepts this historical shape only when the receipt has null usage, `resource_observation_missing`, matching actor and model provider, no process or stop observation, and one later nonretryable pre-start failure terminal. It remains `unavailable`, never zero or observed usage. Supervision counts such a run as terminated for concurrency, because no provider process can still run. Its failure is known safe (`settled_pre_start_failure`), because no tool, command or file effect was possible before the adapter started. Observed usage, another provider, another failure, or an unterminated start makes the receipt invalid. Supervision separately retains the exact reservation unless stronger pre-turn proof settles it.

## Removed governed limits

[ADR-0560](../../../decisions/foundation/0560-remove-unused-subsystems-to-harden-the-core.md) removed the governed-loop token, token-dimension, and managed duration limits with their CLI options and `token_budget_exhausted`, `duration_budget_exhausted`, and `budget_observation_unavailable` finalization checks. The accounting groups above remain the evidence boundary for supervision budgets and reports. No path reserves future resources, preempts a running provider call, establishes billed cost, or proves task correctness.

## Supervision mandate comparability

[ADR-0400](../../../decisions/execution/orchestration/governed-work/0400-prove-default-model-supervision-budget-comparability.md) defines a separate derived supervision total for exactly two complete primary-provider groups differing only in a default versus explicit requested model with one identical observed model.

[ADR-0422](../../../decisions/execution/orchestration/governed-work/resource-accounting/0422-preserve-supervision-budget-across-model-migration.md) also permits two or more complete groups differing only in explicitly requested models when every final answer model matches its request and all other descriptor and counter semantics are exact.

Neither path merges reporting groups, changes descriptor-bound governed limits, infers aliases, combines descendant scopes, normalizes cross-provider usage, or resets historical usage.
