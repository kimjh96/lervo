# Budgets

Execution bounds:

- 1,024 active obligations.
- Eight stages per cycle.
- 16 attempts with backoff.
- Eight documents and 1 MiB of source per delegated batch.
- Eight provider calls.

Before assigning normalization generation, read-only preflight narrows a miss-heavy ordered batch to the largest prefix whose worst-case calls fit the reviewed ceiling, reserving one call for independent review. A single document that cannot fit reports budget failure.

If independent review of a batch of two or more documents exceeds the provider runner timeout, the review stage records proof `review_timed_out` and returns to generation with the private `normalizationDocumentLimit` halved, down to one document. This limit lasts for the obligation; a new baseline starts from the delegated ceiling. A single-document timeout remains a bounded transient retry ([ADR-0465](../../../../../decisions/knowledge/documents/0465-commit-settled-knowledge-documents-at-batch-boundaries.md)).

Durable call reservations precede invocation and survive crashes. Private budget projections retain at most 8,192 batches and prune only canonically terminal obligations.

Generation selects only pending documents within the delegated normalization roots. When all pending documents lie outside those roots, the stage records `waiting_authority/knowledge_normalization_outside_delegation` without a provider call. Its private dependency lists the pending paths and the narrowest roots the delegation would need. A source or delegation change triggers reevaluation ([ADR-0474](../../../../../decisions/knowledge/documents/0474-name-normalization-documents-outside-the-delegation.md)).
