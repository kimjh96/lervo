# Recovery and settlement

The [recovery and retention contract](../../../recovery-and-retention.md) defines failed-assignment reopening, durable host-effect checkpoints, known completed-ref reconciliation, shared target generations, integrator closure, non-force workspace cleanup, bounded archival, and `assignment.convergence.archived`. Unknown effects remain owned uncertainty.

The owner atomically records a stage, queues its successor, and acknowledges its predecessor. Settlement rechecks canonical source/context, private CAS receipt hashes, authority, and the exact lease.

Baseline `current` requires seven verified stage receipts and a stable final lifecycle scan. New sources explicitly supersede old baselines; old terminal events remain immutable.
