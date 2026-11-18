# Lifecycle ordering and settlement

## Batch-boundary commits

`settled-output-boundary.ts` commits settled outputs before stage work at the start of `assessment` and `normalization_generation`. These stages follow every canonical integration and normalization apply ([ADR-0465](../../../../decisions/knowledge/documents/0465-commit-settled-knowledge-documents-at-batch-boundaries.md)).

A returned commit records the stage as `current`, with `committedHead` and private proof `settled_outputs_committed` containing HEAD coordinates and paths. It re-queues the same stage on the advanced snapshot. Discovery matches the obligation's latest snapshot, so the obligation's own commit does not supersede it.

`canonical_review`, `canonical_integration`, `normalization_review`, and `normalization_apply` never commit. The disposition ledger and rejection replay use their stage events as review and integration evidence.

## Reviewed lifecycle effect commits

Under [ADR-0561](../../../../decisions/foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md), a reviewed lifecycle plan is committed by the stage that applies it, not at a later batch boundary. After the lifecycle prefix applies a reviewed layout or instruction bootstrap plan, or `lifecycle_verification` applies a reviewed instruction bridge plan, the stage commits exactly the plan's changed paths as `Lervo Knowledge`. The commit carries `Lervo-Effect`, `Lervo-Effect-Plan`, `Lervo-Effect-Reason`, and `Lervo-Effect-Cross-Check` (`lifecycle reviewer <agent-id> approved`). The stage receipt records the commit as `committedHead`, so the effect source fence accepts the HEAD move as the stage's own child commit, and the proof carries the commit hash. A host without the ADR-0466 commit grant, or a busy checkout, keeps the applied bytes uncommitted and the proof records `commit: null`. `lervo knowledge revert <commit>` undoes the commit.

## Lifecycle verification

`verifyConvergenceLifecycle` resolves candidates, asserts source currency, and invokes the same boundary commit before bridge or migration planning. A returned commit produces a `lifecycle_verification` receipt with another `lifecycle_verification` continuation. Later planning uses the advanced snapshot.

Without returned commit coordinates, planning proceeds, prioritizing a non-current bridge plan, otherwise a migration with changed operations. Apply runs through a writer assignment with current authority, source assertion, lint, verification, and materialization recording. An unreviewed plan keeps the delegated path checks. A bridge plan the independent lifecycle reviewer approved uses `writeScope: reviewed_plan`: its exact changed paths bound the assignment within the parent's responsibility, whatever the delegation's roots ([ADR-0561](../../../../decisions/foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md)).

The output-commit call sits outside those later assignment blocks. The supplied file alone does not prove an outer write lease or authority check for that call.

Final settlement checks unresolved assets, retained canonical rejection, stable captures around currency and lint inspection, exact assessment offset, unique complete source coverage, and permitted dispositions. It then runs verification in a reviewer assignment and reasserts source currency before recording the knowledge snapshot and bounded proof hashes. An output commit alone establishes neither complete coverage nor repository currency.
