# Lifecycle ordering and settlement

`verifyConvergenceLifecycle` resolves candidates first, asserts source currency, and invokes the output commit helper before bridge or migration planning. A returned commit produces a `lifecycle_verification` receipt with another `lifecycle_verification` continuation, committedHead, and private proof containing status `settled_outputs_committed`, HEAD coordinates, and paths. Later planning uses the advanced snapshot.

Without returned commit coordinates, the function proceeds to bridge and migration planning. It prioritizes a non-current bridge plan, otherwise a migration with changed operations. Apply occurs through a writer assignment with delegated path checks, current authority, source assertion, lint, verification, and materialization recording.

The output-commit call is outside those later assignment blocks. The supplied file alone does not prove an outer write lease or authority check for that call.

Final settlement still checks unresolved assets, retained canonical rejection, stable captures around currency and lint inspection, exact assessment offset, unique complete source coverage, and permitted dispositions. It then runs verification in a reviewer assignment and reasserts source currency before recording the knowledge snapshot and bounded proof hashes. An output commit alone establishes neither complete coverage nor repository currency.
