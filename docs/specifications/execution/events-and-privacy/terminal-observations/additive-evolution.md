# Additive evolution

Terminal observation evolution is additive and history-preserving. The original base remains accepted. Later semantic-grounding, query-projection-receipt, durable-instruction, repository, workstream, and workspace groups are each all-or-none; partial groups are invalid.

A query-projection receipt requires the complete grounding group. An earlier complete grounding group remains valid without that later receipt. Current producers emit the complete latest applicable groups. Consumers treat absent later groups as unobserved.

Validation failure never permits deletion, rewriting, or omission of immutable event history.

ADR-0541 adds optional `selectedPointers` to preparation and an all-or-none `selectedCount`/`pathMentionCount` group to observed turns. Historical events without these fields remain valid and report the new counts as unobserved. `path_mention` references require a path-derived document ID; earlier `output_citation` references retain their required concept ID. The reference-event list accepts more than six entries because agent queries can select documents beyond the loaded-document limit.

`context.selected` accepts optional `origin: hook | agent_query | managed_turn`. Historical selections without an origin remain valid, including legacy string scopes. `agent_query` requires document ID, path, content hash, both provider digests, and context event ID together. These turn-binding fields are invalid for other origins.
