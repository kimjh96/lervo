# Responsibility across assignment completion

A completed assignment may retain its preceding responsibility only across one exact revision transition proved by matching `assignment.completion.prepared` and `assignment.completion.reconciled` events.

The latest managed attempt, executor, lease, result artifact, preparation and completion times, unchanged role and acceptance contract, and current state must agree. Missing events, another result, a later revision, or changed duties leave it unbound.

A later system-authored `assignment.role.binding.changed` chain is administrative rather than a replay of the settled task. The observer retains the settled completion revision and its accepted review only when every subsequent assignment revision is one contiguous old-to-new role-binding transition, the first transition starts from the settled responsibility, the last transition exactly matches current generated state, and no other assignment revision intervenes. A gap, reordered event, changed task field, non-system actor, or mismatched final binding leaves the assignment unbound.

This recognition neither records owner acceptance nor grants publication. Normal completion without exact reconciliation evidence still requires a responsibility succession contract.
