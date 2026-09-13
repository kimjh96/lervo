# Review and responsibility

Review observations must follow the current responsibility binding and terminal event, match the current owner and mandate, and recover the exact admitted owner decision and CAS effect through [canonical artifact review](../artifact-review.md). A bare review event is insufficient. The controller separately checks the reviewer, acceptance criteria, exact artifact set, and mandatory verification references. Without review, acceptance remains pending even if verification passes.

A completed assignment may retain its preceding responsibility only across one exact revision transition proved by matching `assignment.completion.prepared` and `assignment.completion.reconciled` events. The latest managed attempt, executor, lease, result artifact, preparation and completion times, unchanged role and acceptance contract, and current state must agree. Missing events, another result, a later revision, or changed duties leave it unbound.

This recognition neither records owner acceptance nor grants publication. Normal completion without exact reconciliation evidence still requires a responsibility succession contract.

The source does not infer delivery from a run result. A headless host without an external origin exposes the accepted canonical result locally and remains idle after goal completion; publication remains unattempted. An explicitly configured conversation origin requires its separate delivery receipt. Removing a transport configuration does not discard previously queued delivery.
