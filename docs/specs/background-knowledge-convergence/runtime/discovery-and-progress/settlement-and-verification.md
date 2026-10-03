# Settlement, recovery, and verification

## Recovery and settlement

The [recovery and retention contract](../../recovery-and-retention.md) defines failed-assignment reopening, durable host-effect checkpoints, known completed-ref reconciliation, shared target generations, integrator closure, non-force workspace cleanup, bounded archival, and `assignment.convergence.archived`. Unknown effects remain owned uncertainty.

The owner atomically records a stage, queues its successor, and acknowledges its predecessor. Settlement rechecks canonical source/context, private CAS receipt hashes, authority, and the exact lease. Baseline `current` requires seven verified stage receipts and a stable final lifecycle scan. New sources explicitly supersede old baselines; old terminal events remain immutable.

## Candidate verification

The version-nine Lervo repository suite prepares detached candidate worktrees with an offline frozen dependency install and local package build before lint, typecheck, and runtime shards. The primary checkout retains its dependency environment. Preparation failure produces no candidate verification receipt or integration success. The integration ref must contain the source being verified.

Interrupted verification yields `knowledge_cancelled`, distinct from an actual `knowledge_verification_failed`. A cancelled stage may resume only after its current source and delegation checks pass under a new live worker signal. Neither result grants verification success.
