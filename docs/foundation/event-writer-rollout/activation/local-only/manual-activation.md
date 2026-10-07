# Manual local-only activation

Follow the [activation requirements](../../activation.md), including version 3 requirements when applicable.

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
