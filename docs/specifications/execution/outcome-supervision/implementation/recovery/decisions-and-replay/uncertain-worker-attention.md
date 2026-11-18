# Uncertain worker attention

An inspected worker failure may still have uncertain effects. When the owner records an exact-basis attention decision, unchanged active work reports `waiting_decision` with `uncertain_effect_attention_pending`, retains the affected assignment IDs, and starts no further model turn until the escalation bound passes. After the bound, the principal proxy inspects the uncertain effect within its mandate instead of waiting for the owner ([ADR-0561](../../../../../../decisions/foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md)).

This waiting state does not reconcile the worker or authorize retry. Changed canonical facts invalidate the attention basis; cancellation still exposes unresolved effects for inspection.
