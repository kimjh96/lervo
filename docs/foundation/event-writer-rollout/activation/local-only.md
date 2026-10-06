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

`lervo upgrade --apply --approval <plan-id>` performs steps 1 through 5 for event schema 4 through its `event_writer` stage ([ADR-0470](../../../decisions/operations/services/0470-admit-every-knowledge-resident-and-run-one-host-resident-service.md)). Before applying, it writes a backup to `.lervo/data/event-writer-backups/schema-4/`: a consistent `VACUUM INTO` copy of `events.sqlite`, the previous `event-contract.json` when present, and `backup.json`. The copy is consistent while other processes append, so writers need not stop. It also refuses activation while the generated terminal hook runtime is stale (`terminal_hook_reader_stale`), because that runtime embeds its own reader.

The host knowledge resident, `lervo init`, and `lervo repository register --write` run the same activation for checkouts whose only reader is the local runtime.

To restore a backup, stop the checkout's writers, copy `events.sqlite` and `event-contract.json` from the backup directory back to `.lervo/data/`, and remove `event-contract.json` there if the backup has none.
