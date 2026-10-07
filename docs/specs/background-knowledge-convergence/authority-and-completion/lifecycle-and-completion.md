# Lifecycle and completion

Run stages in order:

1. Reconcile structural/bootstrap/layout prerequisites.
2. Perform canonical review and integration.
3. Normalize and apply accepted document families.
4. Reconcile bridges and structural projections.
5. Run lint.
6. Replan currency.

Each stage follows ADR-0303's owned-error and rollback rules. Keep unrelated warnings visible. Repository completion requires zero lint errors and current required stages.

Capture source and context hashes before disclosure. Recheck them after provider work, before integration, and inside the settlement fence. Lifecycle inspection binds matching before/after scans and the resulting source snapshot. Changed source becomes `stale`; an expired lease loses settlement authority. Passing on unrelated newer source cannot validate an older review.

A change obligation completes only when:

- Every source partition has a semantic disposition.
- Every required canonical edit is integrated.
- Every required normalization family is current.
- Ordered lifecycle verification passes.
- All bindings match.

A partial workset never closes repository debt. Global currency additionally requires a complete current baseline and no unresolved applicable canonical candidate or authority decision. Status distinguishes source-scoped completion from global currency.

Background writes emit ordinary change evidence causally linked to the parent obligation. Exact normalization outputs covered by the same apply receipt are not regenerated as fresh debt. Genuine new semantic changes remain reviewable. Rejected or unchanged candidates cannot cause an infinite write/normalize loop.

A rejected source never stops the obligation. First attempt bounded regeneration using the reviewer's reasons, then park the source. Every other stage still runs; final verification records `attention_required/knowledge_sources_parked` instead of claiming currency.

The exact lifecycle plan reviewer sees only paths changed by the plan ([ADR-0479](../../../decisions/knowledge/semantics/0479-park-rejected-semantic-candidates-and-settle-opaque-assets-by-the-delegation-suite.md)). Among those paths, `lervo_generated` projection operations without a `destinationPath` are bound by hash and their bytes are withheld. User-owned and managed-block operations, and every move, retain full bytes ([ADR-0481](../../../decisions/knowledge/semantics/0481-bind-generated-projections-by-hash-in-lifecycle-plan-review.md)).

A rejected exact lifecycle plan is parked by kind and plan hash. Assessment and final verification continue past it ([ADR-0485](../../../decisions/knowledge/semantics/0485-reevaluate-settled-semantic-candidates-once-per-evaluation-contract.md)).
