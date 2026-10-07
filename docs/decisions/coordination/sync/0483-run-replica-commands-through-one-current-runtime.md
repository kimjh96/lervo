# ADR-0483: Run replica commands through one current runtime and compare one capture semantics

Status: `accepted`
Decision date: 2026-10-07
Amends: [ADR-0456](0456-hand-off-repositories-atomically-with-a-writer-lease.md) (peer protocol, coordinator configuration), [ADR-0478](0478-renew-each-delegation-with-one-writer.md) (rollout), [ADR-0470](../../operations/services/0470-admit-every-knowledge-resident-and-run-one-host-resident-service.md) (managed user services)
Related: [ADR-0468](0468-propagate-knowledge-supersession-across-replicated-checkouts.md)
Amended by: [ADR-0488](../../operations/services/0488-point-node-configurations-at-one-current-cli.md) (a `current` CLI pointer beside the runtimes, which Node configurations name)

## Context

ADR-0478 changed replica capture to include worktree bytes for a convergence delegation tracked by `HEAD`. After deployment on 2026-10-06, the WSL owner rebound plen at 15:09:38Z. The renewal persisted on WSL but never reached the Mac:

- The Mac coordinator ran `repository-replica reconcile` from Node bundle `440443b568063aac`, which captures tracked delegations. Its launchd plist named that content-addressed payload and was edited manually after each deploy.
- The configuration pinned `peer.remoteRuntimeExecutable: ~/.local/lib/lervo-node/runtime-f9cb5a3a-r1/dist/bin.js` on WSL. That older bundle restores the delegation's `HEAD` entry during capture, ignoring the renewal. The WSL Node itself runs `~/.local/share/lervo/runtimes/node/440443b568063aac`.
- The pinned runtime reported WSL's snapshot as `sha256:ce74c166…`, matching the Mac capture and common base. The coordinator therefore recorded `current` at 15:43:52Z. The current runtime instead captures `sha256:067a5d1f…`.
- A later manual fix put `remoteRuntimeExecutable` at the configuration's top level, where it was silently ignored.

Change detection was correct. Two defects combined: each `lervo upgrade` installs a new content-hashed Node runtime directory, making pinned paths stale, and the coordinator could not distinguish incompatible capture semantics.

## Decision

### Maintain one `current` runtime pointer per host

The Node runtimes directory is `~/Library/Application Support/Lervo/runtimes/node` on macOS and `~/.local/share/lervo/runtimes/node` elsewhere. It holds `current`, a relative symbolic link to an installed `<hash16>` directory. Thus `<runtimes>/current/node-runtime.js` names a complete installed payload.

Replace the pointer by creating a temporary link and renaming it over `current`; readers see either the old or new runtime, never a partial state.

- `applyNodeFleetOnboarding`, used by `lervo upgrade` and Node rollout, points `current` at the activated launcher after readiness and fleet registration succeed.
- Node rollback points `current` back at the restored runtime.
- A failed pointer swap does not fail an already successful activation; the next `lervo upgrade` repairs it.

### Maintain the pointer and replica service during upgrade

The final upgrade stage, `replica_service`, follows `node`. It applies when the host runs a registered Node or has `<user state directory>/repository-replica-coordinator.json`. Other hosts report `current (replica_not_configured)`.

- **Pointer:** `current` must name the running CLI's bundled runtime. Otherwise, install that payload with `materializeInstalledNodeLauncher` and swap the pointer, reporting `runtime_pointer_stale` and pointer action `create` or `update`.
- **Coordinator service:** When a configuration exists, render the service through the shared service renderer with `runtime: repository-replica`:
  - launchd label: `dev.lervo.repository-replica`. Reusing the existing label replaces the definition in place without starting a second coordinator.
  - systemd unit: `lervo-repository-replica.service`.
  - Command: `<node> <runtimes>/current/node-runtime.js repository-replica reconcile --watch --config <config>`.
  - Include the resolved `git` directory in `PATH`.
- **Install and replacement:** The release-tested service manager installs, activates, or transactionally replaces the definition under ADR-0470 host resident service rules. If the new service does not stay active, restore its predecessor.
- **Later deploys:** The definition names the pointer, so its bytes remain unchanged across deploys; subsequent upgrades move only the pointer.
- **Plans:** Carry hashes, the `<hash16>` name, and service identity, never paths. Apply re-plans and rejects changes with `replica_service_plan_stale`. Re-observe a stage deferred behind an applying `node` stage during apply, because Node activation already moved `current`.

### Migrate legacy coordinator configuration during upgrade

Pre-decision hosts keep `~/.lervo/repository-replica-coordinator.json` and pin their peer runtime. If that file exists and the user state directory has no `repository-replica-coordinator.json`, `replica_service` plans migration with `configMigration: migrate` and reason `replica_config_legacy`. The plan binds the migrated content's hash.

Apply proceeds in order:

1. Recheck that the legacy bytes are unchanged.
2. Copy the legacy file exclusively to `<legacy>.pre-adr-0483` with mode 0600.
3. Publish the migrated configuration in the user state directory with mode 0600, using a hard link from a private temporary file. The target appears complete and never replaces an existing file.
4. Render and install the service against the migrated path.
5. Remove the legacy file only after the service runs from the migrated path, preventing further reads of it.

If the service does not stay active, restore its previous definition and retain the legacy file.

Migration changes only `peer.remoteRuntimeExecutable` of the form `<dir>/<hash16>/node-runtime.js` to `peer.remoteRuntimesDirectory: <dir>`. Any other explicit path remains an override. Report `peerRuntimeOverride: true`; upgrade output explains that the path will not follow later deploys.

A legacy file that is not a readable coordinator configuration blocks the stage with `replica_config_legacy_invalid`. If a configuration already exists in the user state directory, never read the legacy file. An explicit `LERVO_USER_STATE_DIRECTORY` also disables the legacy location, isolating tests and custom installations from the home directory.

### Follow the peer's pointer

`peer.remoteRuntimesDirectory` is an absolute path to the peer's runtimes directory; the peer command runs `<directory>/current/node-runtime.js`. `peer.remoteRuntimeExecutable` remains an explicit override. Exactly one must be present.

Reject unknown keys at the top level, in `peer`, or in any repository entry with "The repository replica coordinator configuration is invalid." Unknown keys are no longer ignored.

### Compare snapshots only under matching capture semantics

The pointer removes stale pins, but mixed-version windows and explicit overrides can still pair different semantics. Guard comparison independently:

- **Capture version:** `REPOSITORY_REPLICA_CAPTURE_VERSION` identifies a runtime's capture semantics. Its value is `lervo.repository-replica.capture.v2`, representing ADR-0478 semantics. Change it whenever the same bytes can produce a different snapshot. Derive the snapshot-cache fingerprint version from it.
- **Peer action:** `repository-replica capture-version` prints `{"schemaVersion":1,"captureVersion":"<version>"}`.
- **Order:** After observing both snapshots and before comparing them, check their versions at stage `protocol`.
- **Legacy answer:** A runtime predating the action exits 1 with a usage line that omits it. The SSH adapter interprets this as `lervo.repository-replica.capture.v1`. Check raw stderr because Node prints a long source line before an uncaught usage error.
- **Malformed answer:** Fail with `repository_replica_capture_version_invalid`.
- **Other failures:** Preserve `repository_replica_transfer_failed`, including for SSH exit 255.
- **Mismatch:** Fail with `repository_replica_capture_incompatible`; compare no snapshot, record no reconciliation, and move nothing.
- **Trust window:** Trust a matching pair for 15 minutes per coordinator process.

## Events, state, and failure meaning

No event is added.

New host state is the host-local `current` symbolic link in the Node runtimes directory, holding only a `<hash16>` name. A missing or foreign link means no pointer; the next upgrade creates it.

New failure codes:

- `repository_replica_capture_incompatible` (stage `protocol`): the sides use different capture semantics; nothing was compared or moved.
- `repository_replica_capture_version_invalid` (stage `protocol`): malformed peer answer.
- `repository_replica_capture_version_unsupported`: internal SSH adapter code mapped to the legacy version.
- `replica_service_plan_stale`: the replica service stage changed after plan approval.
- `replica_service_unavailable`: the coordinator service did not stay active after installation or replacement.
- `replica_config_legacy_invalid` (blocker): the legacy `~/.lervo` configuration cannot be read as a coordinator configuration.

The new host file `<legacy>.pre-adr-0483` is an owner-only backup of the migrated legacy configuration, written once.

Upgrade blockers reuse `service_tool_unresolved`, `service_manager_unavailable`, and `service_state_conflict` with ADR-0470 meanings.

## Compatibility and deploy order

A new coordinator works with an old peer runtime and reports incompatibility instead of a false `current`. An old coordinator never calls the new action. Existing `peer.remoteRuntimeExecutable` configurations keep working but become stale at the next deploy.

1. Deploy CLI and Node bundles on both hosts.
2. Run `lervo upgrade` and apply its plan on each host. `replica_service` creates `current` on every Node host. On the coordinating host, it also migrates legacy configuration and replaces the hand-written replica service under the same label.

No file is edited manually.

## Consequences

- Deploys move a pointer; coordinator configuration and replica service definitions need no post-deploy edits.
- Replicas with differing capture semantics stop with a named failure instead of hiding changes.
- Every future capture-semantics change requires a capture-version bump.

## Verification

Focused tests show:

- **Pointer:** Creation, retention, and swaps target only installed runtimes. Missing payloads and unsafe names are refused; refused swaps preserve the previous target. Only launchers inside the runtimes directory are recognized.
- **Upgrade stage:**
  - Hosts that neither coordinate nor run a Node are untouched.
  - A Node host without a service moves its pointer to the bundled runtime.
  - A hand-written `dev.lervo.repository-replica` plist pinning a runtime is replaced as an upgrade with its predecessor by one running `current/node-runtime.js repository-replica reconcile --watch`. It remains byte-identical when a later deploy moves only the pointer.
  - Changed plans are refused.
  - The Mac legacy configuration pinned to `…/runtimes/node/6722dd85a39d6c93/node-runtime.js` migrates to `remoteRuntimesDirectory`, preserving every other field. The migrated file has mode 0600 in the user state directory; the backup contains the original bytes; the legacy file is removed; the service renders against the migrated path.
  - Paths outside any runtimes directory remain reported overrides. Unreadable legacy files block the stage. Existing managed configuration takes precedence over legacy configuration.
- **Renderer:** The replica runtime renders launchd label `dev.lervo.repository-replica`, systemd unit `lervo-repository-replica.service`, and its command.
- **Configuration:** Misplaced top-level `remoteRuntimeExecutable`, unknown `peer` keys, and unknown repository keys are rejected. `remoteRuntimesDirectory` resolves to `<directory>/current/node-runtime.js`. Neither or both runtime options, and relative directories, are rejected.
- **Capture compatibility:** For a Mac–WSL pair tracking the delegation, a legacy-version peer fails at `protocol` without moving the common base or Mac bytes. A current peer then pulls the WSL-only delegation change byte for byte. The SSH adapter maps a current answer, a legacy usage error behind a 20,000-character source line, SSH exit 255, and a malformed answer.
- **Installed evidence (read-only):** Installed WSL bundle `runtime-f9cb5a3a-r1` answered `capture-version` with exit 1 and the legacy usage line.
