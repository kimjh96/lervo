# Additive evolution

Terminal observation evolution is additive and history-preserving. The original base remains accepted. Later semantic-grounding, query-projection-receipt, durable-instruction, repository, workstream, and workspace groups are each all-or-none; partial groups are invalid.

A query-projection receipt requires the complete grounding group. An earlier complete grounding group remains valid without that later receipt. Current producers emit the complete latest applicable groups. Consumers treat absent later groups as unobserved.

Validation failure never permits deletion, rewriting, or omission of immutable event history.
