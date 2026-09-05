# Additive evolution

Terminal observation evolution is additive and history-preserving. The original base remains accepted; later semantic-grounding, query-projection-receipt, durable-instruction, repository, workstream, and workspace groups are all-or-none.

A query-projection receipt requires the complete grounding group; an earlier complete grounding group remains valid without that later receipt. Current producers emit the complete latest applicable groups. Consumers treat absent later groups as unobserved.

A partial group is invalid. Validation failure never permits deletion, rewriting, or omission of immutable event history.
