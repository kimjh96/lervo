# Local-only activation

Follow the [activation requirements](../activation.md), including the version 3 requirements when applicable.

1. Stop repository writers. Use the repository's normal backup procedure to make the existing event database and writer coordinate, if present, recoverable.
2. Upgrade every local reader. Verify that `lervo trace --capabilities --json` advertises readable event schema versions including `[1, 2]` for version 2 or `[1, 2, 3]` for version 3.
3. Capture bounded, secret-free local evidence once:

   ```text
   lervo event-contract evidence --json > event-reader-evidence.json
   ```

4. Produce a read-only plan. Inspect its `status`, blockers, current hash, desired hash, and exact `planId`:

   ```text
   lervo event-contract activate --from event-reader-evidence.json --json
   ```

5. Apply only that exact current plan ID using the same evidence bytes:

   ```text
   lervo event-contract activate --from event-reader-evidence.json --apply <plan-id> --json
   ```

6. Verify `lervo event-contract status --json`, append through an ordinary managed path, and replay the complete mixed chain before restarting concurrent writers.

Evidence creation, planning, and apply are separate operations. A changed manifest, coordinate, capability bundle, or evidence file makes the plan stale before mutation.

## Automatic activation

`lervo upgrade --apply` collects reader evidence, plans, and applies the exact current plan for the current target, event schema 10, through its `event_writer` stage ([ADR-0470](../../../decisions/operations/services/0470-admit-every-knowledge-resident-and-run-one-host-resident-service.md)). Before applying, it writes a backup to `.lervo/data/event-writer-backups/schema-<version>/`, such as `schema-10/`: a consistent `VACUUM INTO` copy of `events.sqlite`, the previous `event-contract.json` when present, and `backup.json`. The copy is consistent while other processes append, so writers need not stop. It also refuses activation while the generated terminal hook runtime is stale (`terminal_hook_reader_stale`), because that runtime embeds its own reader.

The host knowledge resident, `lervo init`, and `lervo repository register --write` run the same activation for checkouts whose only reader is the local runtime.

## Writer rollback and interrupted apply

To return future writes to version 1, follow [writer rollback](../rollback.md). Do not replace the database with a backup for writer rollback: rollback retains all existing events, including higher-version events, and requires readers that support the complete history.

For a pending activation transaction, follow [interrupted apply recovery](../recovery.md) with `lervo event-contract recover --json`. A missing response does not establish whether activation completed. Recovery must report `completed` or `rolled_back`; an unresolved `event_writer_recovery_required` prevents resuming writers. Run status and replay the full chain before resumption.

## Database disaster recovery

The automatic backup is a consistent snapshot, not proof that restoring it preserves the current event history. Events may have been appended after the snapshot, including before activation completed. Copying that snapshot over the live database can discard those events. Database disaster recovery is separate from writer rollback and is not authorized merely by the existence of a backup.

1. Stop every process that can write this checkout's event storage and prevent automatic restarts. Before replacing anything, preserve a separate recoverable copy of the current database, any SQLite journal or WAL files, writer coordinate, pending transaction state, and the activation backup with its metadata. Use the repository's SQLite-safe backup procedure; do not discard journal files or overwrite the only surviving copy.
2. Inspect preserved copies to establish the backup's history boundary and identify every subsequent event. Preserve events appended both before and after activation. If corruption or missing evidence prevents establishing the complete history, keep recovery unresolved and writers stopped.
3. Prepare a recovery candidate separately. Any restoration must preserve or reconcile all post-backup events without rewriting their identities, hashes, versions, or chain order. The supplied activation contract defines no automatic database merge procedure; obtain a reviewed recovery procedure when reconciliation is required. Do not treat an earlier snapshot as the complete current history or silently authorize event loss.
4. Validate the candidate's complete chain and account for every recoverable post-backup event before replacing live storage. Resolve pending activation state through its recovery contract and establish a compatible writer coordinate. Do not blindly restore or remove `event-contract.json` based only on its presence in the backup.
5. Before concurrent writers resume, verify `lervo event-contract status --json`, replay the complete recovered mixed chain, and confirm that all required readers support every version present. With other writers still stopped, append through one ordinary managed path and replay again. Resume only after these checks pass and no transaction or history-reconciliation uncertainty remains. Retain the preserved originals until recovery is verified.
