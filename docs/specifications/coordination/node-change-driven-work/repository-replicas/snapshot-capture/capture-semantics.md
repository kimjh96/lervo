# Capture semantics and host-local paths

Snapshot capture creates Git tree objects through a temporary index. Index-tree observation uses an isolated copy of the user's index, including split-index staging, so Git cache updates cannot notify the coordinator of its own observation. Ordinary observation creates no export commit or ref; bundle creation and explicit history-replacement recovery create the needed commits. No cache authorizes apply or native work without a fresh snapshot.

Capture resets the copied index to `HEAD` with `read-tree --reset`. This produces the same entries as a plain read while retaining stat data for entries already matching `HEAD`, so staging re-hashes only files whose metadata changed ([ADR-0461](../../../../../decisions/operations/services/0461-drive-resident-runtime-service-work-from-changes-not-timers.md)). The copy's timestamp is at least one second before the user's index, ensuring Git's racy-entry check re-hashes files modified in the timestamp tick of the last index write.

## Host-local paths

Worktree bytes from these paths never enter a replica snapshot:

- `.lervo/knowledge/convergence-delegation.json`, only when `HEAD` does not track it
- `.lervo/state`
- `.lervo/data`

Capture excludes these bytes independently of `.gitignore` and ignore rules in `HEAD`. After staging the worktree into the temporary index, it restores the exact `HEAD` entries of `.lervo/state` and `.lervo/data`. It restores the delegation's absent `HEAD` entry only when `HEAD` does not track that file. This restore replaces pathspec exclusion because Git rejects exclusion pathspecs beneath ignored directories.

A delegation tracked by `HEAD` is shared repository content written only by the convergence owner. Capture keeps its worktree bytes, so apply, merge, and rollback reproduce the owner's renewal instead of resetting it to `HEAD` ([ADR-0478](../../../../../decisions/coordination/sync/0478-renew-each-delegation-with-one-writer.md)).

Replica apply preserves untracked host-local paths while cleaning source files, including when resetting to an older `HEAD` temporarily removes the worktree's newer ignore rule. An untracked delegation grant remains local authority and requires separate review on each host.
