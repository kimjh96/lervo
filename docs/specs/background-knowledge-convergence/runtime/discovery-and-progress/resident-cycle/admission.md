# Host-wide full-cycle admission

Only full cycles take host-wide admission, with concurrency one. Admission is stored as `full-cycle-admission.sqlite` in the provider admission directory, by default `~/.lervo/state/knowledge-provider-admission/`. Co-hosted residents serialize capture bursts instead of stacking them.

A waiter polls about once per second and reports health `busy` with reason `knowledge_cycle_admission_wait`. An abort ends the wait with `knowledge_cancelled`.

A holder renews a ten-minute lease every minute. A dead or expired holder never blocks the next waiter.

Admission orders full cycles only. It grants no provider, write or currency authority. Provider admission retains its own two-call limit.
