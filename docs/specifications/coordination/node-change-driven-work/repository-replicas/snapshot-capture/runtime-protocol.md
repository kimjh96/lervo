# Capture version and peer runtime

## Capture version

Each runtime identifies its capture semantics with `REPOSITORY_REPLICA_CAPTURE_VERSION`. The current version, `lervo.repository-replica.capture.v2`, includes the tracked delegation from ADR-0478. `repository-replica capture-version` prints `{"schemaVersion":1,"captureVersion":"..."}`.

After observing both snapshots and before comparing them, every coordinator cycle compares local and peer versions at stage `protocol`:

- A peer runtime predating the action exits 1 with a usage line that does not list it. That answer counts as `lervo.repository-replica.capture.v1`.
- Different versions fail the cycle with `repository_replica_capture_incompatible` before any snapshot is compared or recorded.
- A malformed answer fails with `repository_replica_capture_version_invalid`.
- A matching pair is trusted for 15 minutes per coordinator process ([ADR-0483](../../../../../decisions/coordination/sync/0483-run-replica-commands-through-one-current-runtime.md)).

Bump the version whenever a change lets the same bytes produce a different snapshot. The cache fingerprint version derives from it.

## Peer runtime

The peer command runs `<peer.remoteRuntimesDirectory>/current/node-runtime.js`. `current` is the peer host's atomic runtime pointer, which Node activation and `lervo upgrade` keep at the activated runtime. `peer.remoteRuntimeExecutable` is an explicit override; exactly one of `peer.remoteRuntimesDirectory` and `peer.remoteRuntimeExecutable` is required.

Coordinator configuration accepts only known keys at every level. The coordinator service runs through the local host's `current` pointer.
