# Budgets

Execution bounds:

- 1,024 active obligations.
- Eight stages per cycle.
- 16 attempts with backoff.
- Eight documents and 1 MiB of source per delegated batch.
- Eight provider calls.

Before assigning normalization generation, read-only preflight narrows a miss-heavy ordered batch to the largest prefix whose worst-case calls fit the reviewed ceiling, reserving one call for independent review. A single document that cannot fit still reports budget failure.

Durable call reservations precede invocation and survive crashes. Private budget projections retain at most 8,192 batches and prune only canonically terminal obligations.
