# Host-wide full-cycle admission

Full cycles take host-wide admission with concurrency one. Admission is stored in `full-cycle-admission.sqlite` in the provider admission directory, defaulting to `~/.lervo/state/knowledge-provider-admission/`. Co-hosted residents serialize capture bursts.

Each waiter registers its turn, polls about once per second, and reports health `busy` with reason `knowledge_cycle_admission_wait`. When the slot frees, the oldest waiter that polled within 30 seconds is admitted. An abort withdraws the waiter and ends its wait with `knowledge_cancelled`.

A holder renews a ten-minute lease every minute. Dead or expired holders never block the next waiter. While another repository waits, the holder's convergence owner stops after its current stage; remaining work stays due for its next turn. This prevents a long cycle from starving other residents on the host ([ADR-0485](../../../../../decisions/knowledge/semantics/0485-reevaluate-settled-semantic-candidates-once-per-evaluation-contract.md)).

`lervo upgrade --apply` holds the same admission throughout its apply. It waits at most 15 minutes for a running cycle, then fails with `knowledge_cycle_admission_wait_expired`. No resident cycle on the host starts until the upgrade releases admission ([ADR-0484](../../../../../decisions/operations/services/0484-keep-upgrades-exclusive-with-background-knowledge-work.md)). `lervo upgrade --apply --safe` also plans inside that window, preventing repository changes made while it waits from invalidating its plan ([ADR-0487](../../../../../decisions/operations/services/0487-plan-and-apply-approval-free-upgrades-in-one-exclusive-window.md)).

Admission orders full cycles only; it grants no provider, write, or currency authority. Provider admission retains its separate two-call limit.

Within a cycle, discovery reuses the repository observation while the repository fence and latest knowledge materialization remain unchanged. Only its event-derived half refreshes after a stage ([ADR-0486](../../../../../decisions/knowledge/semantics/0486-regenerate-stale-semantic-candidates-and-reuse-repository-observation.md)).
