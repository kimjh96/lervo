# Ordered stage convergence

## Validation and completion

Each apply stage records pre-materialization lint, validates every error within its responsibility, and rejects transaction-introduced errors. Unrelated pre-existing errors remain visible as stage warnings so the next ordered stage can run. A warning leaves an issue for an ordered later stage; it does not mean the repository is current. Final completion requires global lint with zero errors.

A stage error means the transaction introduced an issue or failed its owned contract and rolled back. If a post-materialization gate fails, output names bounded `code:path` findings observed while staged artifacts existed and states that rollback removed the staged bytes. A later `publication_missing` result cannot be presented as the rollback cause.

## Migration order

Migration materializes structural prerequisites before dependent bridge and normalization work, repeating until final structural refresh and lint are current. Exact source-snapshot and approval bindings remain unchanged.

## Integration-head behavior

`--integration-head` compares the current scan with prior local inventory and reports changed, reused, and removed source counts. Without local state, it performs one full rebuild. `lervo upgrade` plans and reapplies the same integration-head mode. Deferred state cannot claim a newer snapshot.
