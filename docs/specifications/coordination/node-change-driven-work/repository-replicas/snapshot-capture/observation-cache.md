# Observation cache

Coordinator observation—the local snapshot and peer `repository-replica snapshot` command—may serve a cached snapshot. Bundle, apply, merge, post-transfer verification, and readiness admission always capture freshly.

## Storage and fingerprint

The cache is owner-only at `<git-dir>/lervo-replica/snapshot-cache.json`, inside the per-worktree Git directory and never tracked. Its fields are `schemaVersion: 1`, `fingerprint` (a `sha256:` digest), and `snapshot` (the exact snapshot record).

The fingerprint is SHA-256 over:

- A fingerprint tag derived from the capture version.
- The host-local path list and repository root.
- The digest of `git status --porcelain=v2 -z --branch --untracked-files=all`.
- The `lstat` mode, inode, size, and nanosecond modification and change times of the index file, repository `config` and `info/attributes`, and every status-listed path.

Status runs with `GIT_OPTIONAL_LOCKS=0`, so it never writes the user's index or wakes the watcher. Git's stat and racy checks keep clean tracked files out of status. Listed paths include metadata because a second edit of a dirty or untracked file leaves its status line unchanged.

## Cache validity

A hit requires all of the following:

- The stored fingerprint equals the current fingerprint.
- The record's snapshot hash recomputes.
- Its `head` and `branch` equal the status branch coordinates.

Write the cache only when the fingerprint is equal before and after capture and is cacheable. It is not cacheable while any observed timestamp lies within two seconds of observation, while a submodule is listed, while `HEAD` is unborn, or above 20,000 listed paths.

The cache contains only object IDs, digests, and the branch name; no file contents or paths.

## Failures and evidence boundary

A missing, unreadable, invalid, or mismatching record requires full capture. A failed fingerprint falls back to full capture; if that capture fails, retain its structured snapshot stage and Git evidence. A failed cache write leaves the captured snapshot authoritative.

The cache proves only that observation inputs are unchanged. It never claims replica currency or authorizes mutation. No cache authorizes apply or native work without a fresh snapshot.
