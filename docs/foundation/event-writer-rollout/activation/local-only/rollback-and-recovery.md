# Writer rollback and interrupted apply

To return future writes to version 1, follow [writer rollback](../../rollback.md). Do not replace the database with a backup for writer rollback: rollback retains all existing events, including higher-version events, and requires readers that support the complete history.

For a pending activation transaction, follow [interrupted apply recovery](../../recovery.md) with `lervo event-contract recover --json`. A missing response does not establish whether activation completed. Recovery must report `completed` or `rolled_back`; an unresolved `event_writer_recovery_required` prevents resuming writers. Run status and replay the full chain before resumption.
