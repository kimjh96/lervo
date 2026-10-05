# Lifecycle ordering and settlement

## Batch-boundary commits

`settled-output-boundary.ts` commits settled outputs at the start of `assessment` and `normalization_generation`, before the stage's own work. These are the stages that follow every canonical integration and normalization apply ([ADR-0465](../../../../decisions/knowledge/documents/0465-commit-settled-knowledge-documents-at-batch-boundaries.md)). A returned commit records that stage as `current`, with committedHead and private proof `settled_outputs_committed` (HEAD coordinates and paths), and re-queues the same stage on the advanced snapshot. Discovery matches the obligation's latest snapshot, so the obligation's own commit does not supersede it. `canonical_review`, `canonical_integration`, `normalization_review`, and `normalization_apply` never commit. The disposition ledger and rejection replay read their stage events as review and integration evidence.

## Lifecycle verification

`verifyConvergenceLifecycle` resolves candidates first, asserts source currency, and invokes the same boundary commit before bridge or migration planning. A returned commit produces a `lifecycle_verification` receipt with another `lifecycle_verification` continuation. Later planning uses the advanced snapshot.

Without returned commit coordinates, the function proceeds to bridge and migration planning. It prioritizes a non-current bridge plan, otherwise a migration with changed operations. Apply occurs through a writer assignment with delegated path checks, current authority, source assertion, lint, verification, and materialization recording.

The output-commit call is outside those later assignment blocks. The supplied file alone does not prove an outer write lease or authority check for that call.

Final settlement still checks unresolved assets, retained canonical rejection, stable captures around currency and lint inspection, exact assessment offset, unique complete source coverage, and permitted dispositions. It then runs verification in a reviewer assignment and reasserts source currency before recording the knowledge snapshot and bounded proof hashes. An output commit alone establishes neither complete coverage nor repository currency.
