# Budgets

Execution bounds:

- 1,024 active obligations.
- Eight stages per cycle.
- 16 attempts with backoff.
- Eight documents and 1 MiB of source per delegated batch.
- Eight provider calls.

Before assigning normalization generation, read-only preflight narrows a miss-heavy ordered batch to the largest prefix whose worst-case calls fit the reviewed ceiling, reserving one call for independent review. A single document that cannot fit still reports budget failure.

If the independent review of a batch of two or more documents exceeds the provider runner timeout, the review stage records proof `review_timed_out` and returns to generation with private `normalizationDocumentLimit` halved, down to one document. The limit lasts for the obligation; a new baseline starts from the delegated ceiling. A timeout on a single document stays a bounded transient retry ([ADR-0465](../../../../../decisions/knowledge/documents/0465-commit-settled-knowledge-documents-at-batch-boundaries.md)).

Durable call reservations precede invocation and survive crashes. Private budget projections retain at most 8,192 batches and prune only canonically terminal obligations.
