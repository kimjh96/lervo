# Managed document selection

Managed sessions suppress native project hooks. [ADR-0523](../../../../decisions/search/activation/0523-retire-reviewed-relation-context.md) removed reviewed relation projections from knowledge query and graph recommendations from managed context. The `graph_recommendation` selection reason remains in the event schema so stored `context.selected` events keep validating. No code path emits it.

No run selects linked-only sources after search. [ADR-0528](../../../../decisions/search/activation/0528-remove-the-linked-evidence-canary-and-shadow.md) removed the default-off canary; the managed linked-evidence specification records its history.
