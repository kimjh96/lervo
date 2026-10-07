# ADR-0483: Run replica commands through one current runtime and compare one capture semantics

Status: `accepted`
Decision date: 2026-10-07
Amends: [ADR-0456](0456-hand-off-repositories-atomically-with-a-writer-lease.md) (peer protocol, coordinator configuration), [ADR-0478](0478-renew-each-delegation-with-one-writer.md) (rollout), [ADR-0470](../../operations/services/0470-admit-every-knowledge-resident-and-run-one-host-resident-service.md) (managed user services)
Related: [ADR-0468](0468-propagate-knowledge-supersession-across-replicated-checkouts.md)
Amended by: [ADR-0488](../../operations/services/0488-point-node-configurations-at-one-current-cli.md) (a `current` CLI pointer beside the runtimes, which Node configurations name)

## Context

ADR-0478 changed replica capture so that a convergence delegation that `HEAD` tracks enters the snapshot with its worktree bytes. After it was deployed on 2026-10-06, the WSL owner rebound plen at 15:09:38Z, and the renewal persisted on WSL. The Mac never received it:

- The Mac coordinator ran `repository-replica reconcile` from the current Node bundle `440443b568063aac`, which captures a tracked delegation. Its launchd plist names that content-addressed payload, and the plist was edited by hand after each deploy.
- The coordinator configuration pinned the peer command to `peer.remoteRuntimeExecutable: ~/.local/lib/lervo-node/runtime-f9cb5a3a-r1/dist/bin.js` on WSL. That older bundle still restores the delegation's `HEAD` entry during capture, so its snapshot of WSL ignored the renewal. The WSL Node itself runs `~/.local/share/lervo/runtimes/node/440443b568063aac`.
- The pinned runtime reported `sha256:ce74c166…` for WSL. That equaled the Mac's own capture and the common base, so the coordinator recorded `current` at 15:43:52Z. A capture with the current runtime gives `sha256:067a5d1f…`.
- A later manual fix placed `remoteRuntimeExecutable` at the top level of the configuration, where it was silently ignored.

Change detection was not at fault. Two defects combined. Every `lervo upgrade` installs the Node runtime under a new content-hashed directory, so any pinned runtime path goes stale at the next deploy. The coordinator also compared snapshots from two capture semantics without being able to tell.

## Decision

### Every host keeps one `current` runtime pointer

The Node runtimes directory is `~/Library/Application Support/Lervo/runtimes/node` on macOS and `~/.local/share/lervo/runtimes/node` elsewhere. It now holds `current`, a relative symbolic link to one installed `<hash16>` directory. `<runtimes>/current/node-runtime.js` therefore always names a complete installed payload. The link is replaced by creating a temporary link and renaming it over `current`. A reader sees either the old runtime or the new one, never a partial state.

Lervo moves the pointer at activation:

- `applyNodeFleetOnboarding`, used by `lervo upgrade` and Node rollout, points `current` at the launcher it activated, after readiness and fleet registration succeed.
- A Node rollback points `current` back at the restored runtime.
- A failed pointer swap never fails an activation that already succeeded. The next `lervo upgrade` repairs the pointer.

### `lervo upgrade` maintains the pointer and the replica service

A new last upgrade stage, `replica_service`, runs after the `node` stage. It applies to a host that runs a registered Node, or that has a coordinator configuration at `<user state directory>/repository-replica-coordinator.json`. Other hosts report `current (replica_not_configured)`.

- **Pointer.** `current` must name the runtime bundled with the running CLI. If it does not, the stage installs that payload (`materializeInstalledNodeLauncher`) and swaps the pointer (`runtime_pointer_stale`, pointer action `create` or `update`).
- **Coordinator service.** With a configuration present, the stage renders the replica coordinator service through the shared service renderer (`runtime: repository-replica`).
  - launchd label: `dev.lervo.repository-replica`. Keeping the label existing hosts already use means the managed definition replaces that file in place and never starts a second coordinator.
  - systemd unit: `lervo-repository-replica.service`.
  - Command: `<node> <runtimes>/current/node-runtime.js repository-replica reconcile --watch --config <config>`. The `PATH` includes the resolved `git` directory.
- **Install and replace.** The release-tested service manager installs, activates, or transactionally replaces the definition. It uses the same rules as the ADR-0470 host resident service, and restores the predecessor if the new service does not stay active.
- **Later deploys.** The definition names the pointer, not a runtime hash, so its bytes do not change across deploys. Later upgrades move only the pointer.
- **Planning and stale plans.** The plan carries hashes, the `<hash16>` name, and the service identity, never paths. Apply re-plans and refuses a changed plan with `replica_service_plan_stale`. A stage deferred behind an applying `node` stage is re-observed during apply, because the Node activation already moved `current`.

### `lervo upgrade` migrates the legacy coordinator configuration

Hosts configured before this decision keep the coordinator configuration at `~/.lervo/repository-replica-coordinator.json`, and their peer is pinned to one runtime. When that file exists and the user state directory holds no `repository-replica-coordinator.json`, the `replica_service` stage plans a migration (`configMigration: migrate`, reason `replica_config_legacy`). The plan binds the hash of the migrated content.

On apply, the stage performs these steps in order:

1. It rechecks that the legacy bytes are unchanged.
2. It copies the legacy file to `<legacy>.pre-adr-0483`, exclusively and with mode 0600.
3. It publishes the migrated configuration in the user state directory with mode 0600. Publication goes through a hard link from a private temporary file, so the target appears complete and never replaces an existing file.
4. It renders and installs the service against the migrated path.
5. After the service runs from the migrated path, it removes the legacy file, so nothing reads it again.

If the service does not stay active, the service manager restores the previous definition, and the legacy file stays in place.

The migration changes one thing. A `peer.remoteRuntimeExecutable` of the form `<dir>/<hash16>/node-runtime.js` becomes `peer.remoteRuntimesDirectory: <dir>`. Any other explicit path stays an override. The stage reports it (`peerRuntimeOverride: true`), and the upgrade output explains that such a path will not follow later deploys. A legacy file that is not a readable configuration blocks the stage with `replica_config_legacy_invalid`. If the user state directory already holds a configuration, the legacy file is never read. An explicit `LERVO_USER_STATE_DIRECTORY` also disables the legacy location, which keeps tests and custom installations isolated from the home directory.

### The coordinator follows the peer's pointer

`peer.remoteRuntimesDirectory` names the peer's runtimes directory as an absolute path. The peer command then runs `<directory>/current/node-runtime.js`. `peer.remoteRuntimeExecutable` remains as an explicit override. Exactly one of the two must be present.

The configuration contract is now exact. An unknown key at the top level, in `peer`, or in a repository entry fails the configuration with "The repository replica coordinator configuration is invalid." It is no longer ignored.

### Snapshots are compared only under one capture semantics

The pointer removes stale pins, but a mixed-version window or an explicit override can still pair two semantics. Comparison is therefore guarded independently:

- **Capture version.** `REPOSITORY_REPLICA_CAPTURE_VERSION` names the capture semantics one runtime implements. It is now `lervo.repository-replica.capture.v2`, the ADR-0478 semantics. It must change whenever the same bytes can produce a different snapshot. The snapshot-cache fingerprint version derives from it.
- **Peer action.** `repository-replica capture-version` prints `{"schemaVersion":1,"captureVersion":"<version>"}`.
- **Check order.** After a cycle observes both snapshots and before it compares them, it checks the two versions at stage `protocol`.
- **Peer answers.**
  - A runtime older than the action exits 1 with a usage line that does not list it. The SSH adapter reads that answer as `lervo.repository-replica.capture.v1`. It checks raw stderr, because Node prints a long source line before an uncaught usage error.
  - A malformed answer fails with `repository_replica_capture_version_invalid`.
  - Any other failure, such as SSH exit 255, stays `repository_replica_transfer_failed`.
- **Mismatch.** Different versions fail with `repository_replica_capture_incompatible`. The cycle compares no snapshot, records no reconciliation, and moves nothing.
- **Trust window.** A matching pair is trusted for 15 minutes per coordinator process.

## Events, state, and failure meaning

No event is added.

New host state: the `current` symbolic link in the Node runtimes directory. It is host-local and holds only a `<hash16>` name. A missing or foreign link means no pointer; the next upgrade creates it.

New failure codes:

- `repository_replica_capture_incompatible` (stage `protocol`): the two sides capture under different semantics; nothing was compared or moved.
- `repository_replica_capture_version_invalid` (stage `protocol`): the peer's answer was malformed.
- `repository_replica_capture_version_unsupported`: internal to the SSH adapter, which maps it to the legacy version.
- `replica_service_plan_stale`: the replica service stage changed after the plan was approved.
- `replica_service_unavailable`: the coordinator service did not stay active after install or replacement.
- `replica_config_legacy_invalid` (blocker): the legacy `~/.lervo` configuration cannot be read as a coordinator configuration.

New host files: `<legacy>.pre-adr-0483`, an owner-only backup of the migrated legacy configuration, written once.

Upgrade blockers reuse `service_tool_unresolved`, `service_manager_unavailable`, and `service_state_conflict` with their ADR-0470 meanings.

## Compatibility and deploy order

A new coordinator works with an old peer runtime and reports the incompatibility instead of a false `current`. An old coordinator never calls the new action. A configuration that still uses `peer.remoteRuntimeExecutable` keeps working, but it goes stale at the next deploy.

1. Deploy the CLI and Node bundles on both hosts.
2. Run `lervo upgrade` and apply its plan on each host. On every host that runs a Node, the `replica_service` stage creates `current`. On the coordinating host, it also migrates the legacy configuration and replaces the hand-written replica service definition under the same label.

No file is edited by hand.

## Consequences

- Deploys move a pointer, not a pinned path. No coordinator configuration or replica service definition needs editing after a deploy.
- A replica whose two sides still capture differently stops with a named failure instead of hiding a change.
- Every future change to capture semantics must bump the capture version.

## Verification

Focused tests show:

- **Pointer:** the pointer is created, kept, and swapped only at installed runtimes. A missing payload and an unsafe name are refused, and a refused swap keeps the previous target. Only launchers inside the runtimes directory are recognized.
- **Upgrade stage:**
  - A host that neither coordinates nor runs a Node is untouched.
  - A Node host's pointer moves to the bundled runtime without a service.
  - A hand-written `dev.lervo.repository-replica` plist that pins a runtime is replaced, as an upgrade with its predecessor, by one that runs `current/node-runtime.js repository-replica reconcile --watch`. It stays byte-identical when a later deploy moves only the pointer.
  - A changed plan is refused.
  - The Mac's legacy configuration, pinned to `…/runtimes/node/6722dd85a39d6c93/node-runtime.js`, migrates to `remoteRuntimesDirectory` with every other field kept. The migrated file is mode 0600 in the user state directory, the backup holds the original bytes, the legacy file is gone, and the service renders against the migrated path.
  - A path outside any runtimes directory stays a reported override. An unreadable legacy file blocks the stage. An existing managed configuration wins over the legacy file.
- **Renderer:** the replica runtime renders the launchd label `dev.lervo.repository-replica`, the systemd unit `lervo-repository-replica.service`, and its command.
- **Configuration:** a misplaced top-level `remoteRuntimeExecutable`, an unknown `peer` key, and an unknown repository key are each rejected. `remoteRuntimesDirectory` resolves to `<directory>/current/node-runtime.js`. Neither or both runtime options, and a relative directory, are rejected.
- **Capture compatibility:** in a Mac and WSL pair that tracks the delegation, a legacy-version peer fails the cycle at `protocol` without moving the common base or the Mac's bytes. A current peer then pulls the WSL-only delegation change byte for byte. The SSH adapter maps a current answer, a legacy usage error behind a 20,000-character source line, SSH exit 255, and a malformed answer.
- **Installed evidence (read-only):** the installed WSL bundle `runtime-f9cb5a3a-r1` answered `capture-version` with exit 1 and the legacy usage line.
