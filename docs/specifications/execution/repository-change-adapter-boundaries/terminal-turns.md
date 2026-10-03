# Terminal turns

`apps/cli/src/terminal-repository-change.ts` returns null when:

- Lifecycle inspection reports no change.
- The writable event schema version is below 3.
- The prepared context lacks a string observation ID.
- The corresponding prepared snapshot is absent.
- The prepared snapshot's revision differs from the lifecycle's before revision.

The adapter captures a fresh after snapshot. If its revision differs from the lifecycle's after revision, it returns null rather than binding post-inspection changes to the observed turn. A null repository-planner result also produces no append. Otherwise, it stores the manifest and requires the returned content hash to match the planned source-manifest hash.

Planning uses source kind `terminal_turn` and the supplied turn event ID. The project ID is passed when the supplied storage exposes a manifest. Prepared snapshots contain hashes and optional commit coordinates, not former dirty file bodies; planning establishes neither reconstructability nor successful semantic review.

`appendTerminalRepositoryChange` accepts an existing transaction, derives append coordinates through `terminalEventDraft`, and delegates to `appendRepositoryChange`. It neither opens the transaction nor appends the observed turn itself. The caller owns atomic pairing with `terminal.turn.observed`, fail-soft hook handling, and any worker launch.
