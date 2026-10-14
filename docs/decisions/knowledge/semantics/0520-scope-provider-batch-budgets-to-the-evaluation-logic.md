# ADR-0520: Scope provider batch budgets to the evaluation logic

Status: `accepted`
Decision date: 2026-10-14
Amends: [ADR-0485](0485-reevaluate-settled-semantic-candidates-once-per-evaluation-contract.md)

## Context

Each semantic stage batch reserves a provider call before it runs. The reservation is durable and survives failures, cancellations and restarts, and a batch allows at most three calls. When the reservations are spent, the stage settles `attention_required` with `normalization_budget_exceeded`. The rows are released only when the obligation reaches its terminal event.

On 2026-10-14 the WSL host restarted at 09:10 UTC for a disk compaction. flemo's next assessment was cancelled twice within seconds, at 09:11 and 09:12. Each cancellation had already reserved a call, so the third attempt found the batch exhausted. At 09:39 the deploy of new logic requeued the stage under ADR-0485, and it failed again within a second on the same spent batch. The stage would stay stuck until flemo's sources changed.

ADR-0519 already gives new logic one attempt on an exhausted assignment. The batch budget blocked the same reevaluation one level lower.

## Decision

A batch budget is keyed by the batch and the current evaluation contract. Under one evaluation logic, reservations still survive retries, cancellations and restarts, and a batch never exceeds its call limit. Deploying new logic gives each batch one fresh budget. Rows keyed without the current contract, including rows written before this decision, no longer count. They are pruned with their obligation as before.

## Consequences

An ADR-0485 reevaluation can actually call the provider again for a stage whose batch budget an earlier run spent. Spend stays bounded at one batch budget per batch per deploy of new logic.

No event type or state is added. The private budget projection's key now covers the evaluation contract.

## Verification

Provider budget tests cover:

- reservations persisting within one logic;
- a batch exhausted under an earlier key receiving exactly one fresh budget.
