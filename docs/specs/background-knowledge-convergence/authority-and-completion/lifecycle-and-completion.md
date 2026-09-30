# Lifecycle and completion

Run stages in order: reconcile structural/bootstrap/layout prerequisites; perform canonical review and integration; normalize and apply accepted document families; reconcile bridges and structural projections; run lint; replan currency. Each stage follows ADR-0303's owned-error and rollback rules. Keep unrelated warnings visible. Repository completion requires zero lint errors and current required stages.

Capture source and context hashes before disclosure. Recheck them after provider work, before integration, and inside the settlement fence. Lifecycle inspection binds matching before/after scans and the resulting source snapshot. Changed source becomes `stale`; an expired lease loses settlement authority. Passing on unrelated newer source cannot validate an older review.

A change obligation completes only when every source partition has a semantic disposition, every required canonical edit is integrated, every required normalization family is current, ordered lifecycle verification passes, and all bindings match. A partial workset never closes repository debt. Global currency additionally requires a complete current baseline and no unresolved applicable canonical candidate or authority decision. Status distinguishes source-scoped completion from global currency.

Background writes emit ordinary change evidence causally linked to the parent obligation. Exact normalization outputs covered by the same apply receipt are not regenerated as fresh debt. Genuine new semantic changes remain reviewable. Rejected or unchanged candidates cannot cause an infinite write/normalize loop.
