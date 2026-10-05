# Lifecycle ordering and settlement

## Batch-boundary commits

`settled-output-boundary.ts` commits settled outputs before stage work at the start of `assessment` and `normalization_generation`. These stages follow every canonical integration and normalization apply ([ADR-0465](../../../../decisions/knowledge/documents/0465-commit-settled-knowledge-documents-at-batch-boundaries.md)).

A returned commit records the stage as `current`, with `committedHead` and private proof `settled_outputs_committed` containing HEAD coordinates and paths. It re-queues the same stage on the advanced snapshot. Discovery matches the obligation's latest snapshot, so the obligation's own commit does not supersede it.

`canonical_review`, `canonical_integration`, `normalization_review`, and `normalization_apply` never commit. The disposition ledger and rejection replay use their stage events as review and integration evidence.

## Lifecycle verification

`verifyConvergenceLifecycle` resolves candidates, asserts source currency, and invokes the same boundary commit before bridge or migration planning. A returned commit produces a `lifecycle_verification` receipt with another `lifecycle_verification` continuation. Later planning uses the advanced snapshot.

Without returned commit coordinates, planning proceeds, prioritizing a non-current bridge plan, otherwise a migration with changed operations. Apply runs through a writer assignment with delegated path checks, current authority, source assertion, lint, verification, and materialization recording.

The output-commit call sits outside those later assignment blocks. The supplied file alone does not prove an outer write lease or authority check for that call.

Final settlement checks unresolved assets, retained canonical rejection, stable captures around currency and lint inspection, exact assessment offset, unique complete source coverage, and permitted dispositions. It then runs verification in a reviewer assignment and reasserts source currency before recording the knowledge snapshot and bounded proof hashes. An output commit alone establishes neither complete coverage nor repository currency.
