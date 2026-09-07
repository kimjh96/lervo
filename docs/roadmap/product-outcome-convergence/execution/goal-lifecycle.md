# Durable repository goal lifecycle

State: `implemented`

Outcome: repository goals have a durable lifecycle instead of disconnected prose.

Evidence: the verified workstream remains root-goal authority; its assignment DAG remains execution authority. `loop goal` and protocol-v2 `operating_goal.inspect` compose explicit status, hierarchy, progress, blocking, completion readiness, and inconsistency without a second store or provider start.

Preserve explicit workstream completion and false authority flags. Independent nested goals and dynamic topology remain separate unsupported capabilities. The later protocol v5 scheduler consumes this read-only projection without changing its authority flags.
