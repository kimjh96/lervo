# Uncertain worker attention

An inspected worker failure may still have uncertain effects. When the owner records an exact-basis attention decision, unchanged active work reports `waiting_decision` with `uncertain_effect_attention_pending`, retains the affected assignment IDs, and starts no further model turn.

This waiting state does not reconcile the worker or authorize retry. Changed canonical facts invalidate the attention basis; cancellation still exposes unresolved effects for inspection.
