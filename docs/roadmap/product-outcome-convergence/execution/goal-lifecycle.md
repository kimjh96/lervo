# Durable repository goal lifecycle

State: `wired`

Repository goals have a durable lifecycle instead of disconnected prose.

The verified workstream remains root-goal authority; its assignment DAG remains execution authority. `loop goal` and protocol-v2 `operating_goal.inspect` compose explicit status, hierarchy, progress, blocking, completion readiness, and inconsistency without a second store or provider start.

Preserve explicit workstream completion and false authority flags. Independent nested goals remain unsupported. The later protocol v5 scheduler and protocol v6 reviewed topology boundary consume the workstream and DAG without changing goal-projection authority flags.
