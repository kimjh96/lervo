# Snapshot capture

Snapshot capture creates Git tree objects through a temporary index. Index-tree observation uses an isolated copy of the user's index, including split-index staging, so Git cache updates cannot notify the coordinator of its own observation. Ordinary observation creates no export commit or ref; bundle creation and explicit history-replacement recovery create needed commits. No cache authorizes apply or native work without a fresh snapshot.

Capture resets the copied index to `HEAD` with `read-tree --reset`. This produces the same entries as a plain read while retaining stat data for entries already matching `HEAD`, so staging re-hashes only files whose metadata changed ([ADR-0461](../../../../decisions/operations/services/0461-drive-resident-runtime-service-work-from-changes-not-timers.md)). The copy's timestamp is at least one second before the user's index, ensuring Git's racy-entry check re-hashes files modified in the timestamp tick of the last index write.

## Host-local paths

Worktree bytes from these host-local paths never enter a replica snapshot:

- `.lervo/knowledge/convergence-delegation.json`
- `.lervo/state`
- `.lervo/data`

Capture excludes them independently of `.gitignore` and ignore rules in `HEAD`: after staging the worktree into the temporary index, it restores their exact `HEAD` entries. This restore replaces a pathspec exclusion because Git rejects exclusion pathspecs beneath ignored directories.

The delegation is host-local only while `HEAD` does not track it. A delegation that `HEAD` tracks is shared repository content that only the convergence owner writes, so capture keeps its worktree bytes. Apply, merge, and rollback then reproduce the owner's renewal instead of resetting it to `HEAD` ([ADR-0478](../../../../decisions/coordination/sync/0478-renew-each-delegation-with-one-writer.md)).

Replica apply preserves the untracked host-local paths while cleaning source files, including when resetting to an older `HEAD` temporarily removes the worktree's newer ignore rule. An untracked delegation grant remains local authority and requires separate review on each host.

## Transfer and readiness

A bundle request binds the exact snapshot hash selected by reconciliation. Source advancement before bundle creation cannot substitute newer bytes for that decision's bytes.

After an exact target apply, the coordinator persists the transferred snapshot as the new common base before recapturing the active source. If the source advanced concurrently, the cycle remains pending; its successor proceeds as a one-sided change rather than manufacturing dual divergence from the older base.

A readiness receipt is written only after both observed sides are equal. After a transfer, both sides must first be recaptured. Readiness admission compares the receipt with a fresh capture.

## Observation cache

Coordinator observation—the local snapshot and peer `repository-replica snapshot` command—may serve a cached snapshot. Bundle, apply, merge, post-transfer verification, and readiness admission always capture freshly.

- **Location:** `<git-dir>/lervo-replica/snapshot-cache.json`, owner-only, inside the per-worktree Git directory and never tracked.
- **Fields:** `schemaVersion: 1`, `fingerprint` (a `sha256:` digest), and `snapshot` (the exact snapshot record).
- **Fingerprint:** SHA-256 over a capture-version tag (`v2` since ADR-0478), the host-local path list, the repository root, the digest of `git status --porcelain=v2 -z --branch --untracked-files=all`, and the `lstat` mode, inode, size, and nanosecond modification and change times of the index file, repository `config` and `info/attributes`, and every status-listed path. Status runs with `GIT_OPTIONAL_LOCKS=0`, so it never writes the user's index or wakes the watcher. Git's stat and racy checks keep clean tracked files out of status. Listed paths include metadata because a second edit of a dirty or untracked file leaves its status line unchanged.
- **Hit:** the stored fingerprint equals the current fingerprint, the record's snapshot hash recomputes, and its `head` and `branch` equal the status branch coordinates.
- **Write:** only when the fingerprint is equal before and after capture and is cacheable. It is not cacheable while any observed timestamp lies within two seconds of observation, while a submodule is listed, while `HEAD` is unborn, or above 20,000 listed paths.
- **Privacy:** object IDs, digests, and the branch name only; no file contents or paths.
- **Failures:** a missing, unreadable, invalid, or mismatching record requires full capture. A failed fingerprint falls back to full capture; if that capture fails, its structured snapshot stage and Git evidence are retained. A failed cache write leaves the captured snapshot authoritative.

The cache proves only that observation inputs are unchanged. It never claims replica currency or authorizes mutation.
