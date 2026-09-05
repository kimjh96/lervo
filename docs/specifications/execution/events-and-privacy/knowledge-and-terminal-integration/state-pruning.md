# State pruning

`state.pruned` records the exact prune-plan ID, policy and inventory hashes, removed-file and byte totals, bounded per-class counts, and application time. It excludes artifact paths and path digests, content hashes and bodies, source text, credentials, and recovery-journal details.

The event means eligible derived bytes were detached and durable evidence committed. Event failure restores detached targets and emits no success. A crash before or after event commit leaves a recovery tombstone. Explicit recovery restores bytes if the event is absent or completes cleanup if it is present.
