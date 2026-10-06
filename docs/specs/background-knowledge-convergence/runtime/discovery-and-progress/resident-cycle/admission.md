# Host-wide full-cycle admission

Only full cycles take host-wide admission, with concurrency one. Admission is stored as `full-cycle-admission.sqlite` in the provider admission directory, by default `~/.lervo/state/knowledge-provider-admission/`. Co-hosted residents serialize capture bursts instead of stacking them.

A waiter polls about once per second and reports health `busy` with reason `knowledge_cycle_admission_wait`. Each waiter registers its turn. When the slot frees, the oldest waiter that polled within 30 seconds is admitted. An abort withdraws the waiter and ends the wait with `knowledge_cancelled`.

A holder renews a ten-minute lease every minute. A dead or expired holder never blocks the next waiter. While another repository waits, the holder's convergence owner stops after its current stage. The remaining work stays due for its next turn, so one long cycle cannot starve every other resident on the host ([ADR-0483](../../../../../decisions/knowledge/semantics/0483-reevaluate-settled-semantic-candidates-once-per-evaluation-contract.md)).

`lervo upgrade --apply` holds the same admission for its whole apply. It waits at most 15 minutes for a running cycle and then fails with `knowledge_cycle_admission_wait_expired`. No resident cycle on the host starts until the upgrade releases the admission ([ADR-0484](../../../../../decisions/operations/services/0484-keep-upgrades-exclusive-with-background-knowledge-work.md)).

Admission orders full cycles only. It grants no provider, write or currency authority. Provider admission retains its own two-call limit.
