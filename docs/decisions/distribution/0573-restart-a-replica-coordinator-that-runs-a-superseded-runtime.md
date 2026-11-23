# ADR-0573: Restart a replica coordinator that runs a superseded runtime

Status: `accepted`
Decision date: 2026-11-17
Amends: [ADR-0483](../coordination/sync/0483-run-replica-commands-through-one-current-runtime.md) (replica service stage), [ADR-0628](../coordination/sync/0628-bounded-replica-transport-and-service-completion.md) (terminal service inspection)
Related: [ADR-0470](../operations/services/0470-admit-every-knowledge-resident-and-run-one-host-resident-service.md), [ADR-0570](../operations/services/0570-reuse-one-replica-peer-connection-and-back-off-an-unreachable-peer.md)

## Context

ADR-0483 made the replica coordinator service run `<node> <runtimes>/current/node-runtime.js repository-replica reconcile --watch`. Its definition names the `current` pointer, so it stays byte-identical across deploys. `lervo upgrade` moves only the pointer.

Moving the pointer does not change a running process. Node resolves the main script once, at start. The `replica_service` stage compared only definition bytes, saw no change, and left the old process running. On the owner's Mac, `dev.lervo.repository-replica` ran code from 2026-10-13 through five releases. Every coordinator fix, such as the ADR-0570 connection reuse in v0.24.0, needed a manual restart on every host.

The process also held back runtime retention there. Retention defers while a process runs through `current` without a runtime binding, and that coordinator predates bindings.

## Decision

### A running coordinator proves which runtime it loaded

Payloads built since 2026-10-25 bind themselves when they start (`bindInstalledRuntimeProcess`). The payload resolves its own script to the physical `<hash16>` directory and writes `<runtimes>/<hash16>/.processes/<pid>.json`. The record holds `schemaVersion: 1`, `processId`, `runtimeDirectory`, and `processIdentity`. The identity is the process birth identity: boot session and start time, read from `/proc` on Linux and from `sysctl` and `ps` on macOS. Neither needs root.

A coordinator is bound to runtime `R` when all of these hold:

1. The service manager reports the coordinator's process id.
2. Exactly one runtime directory has a binding record for that id.
3. That record's `processIdentity` equals the process's observed birth identity now.
4. That directory is `R`.

Anything else is unproven: another runtime, no record, an id the manager did not report, a reused id, or a process whose identity cannot be read. Unproven is treated as stale. The only remedy is a restart through the service manager, and a needless restart costs one short coordinator pause. A missed restart leaves old code running until someone notices.

The comparison uses what the payload recorded about itself, not a path or a timestamp. A process command line still shows `current/node-runtime.js` after the pointer moves. A start time compared to the pointer's change time breaks on clock changes and second-resolution `ps` output.

### The service manager reports the process id

The `status` action of the release-tested service manager adds `processId`. It is null when no process runs.

- launchd: the job's own top-level `pid = <n>` line from `launchctl print gui/<uid>/<label>`.
- systemd: `systemctl --user show --property=MainPID --value <unit>`. A value of `0` means no process.

Both commands run as the logged-in user. Install, upgrade, and remove observations are unchanged.

### The upgrade stage restarts a stale coordinator

When the installed definition already equals the rendered one and the service is running, the `replica_service` stage checks the binding against the runtime `current` names after the stage applies. That is the bundled runtime of the CLI running `lervo upgrade`.

- Bound: `current (replica_service_current)`, as before.
- Not bound: `safe_apply`, reason `replica_service_stale_runtime`, action `restart`.
- Not running: `activate (replica_service_inactive)`, as before. No process is judged.

A definition change still plans `upgrade`, which already starts a new process.

Apply holds one host lock for the whole stage: `repository-replica-service.lock` beside the coordinator configuration in the user state directory. It uses the same PID lock as runtime retention. The state directory may be reached through a symbolic link, such as a relocated `~/.local/state` or `LERVO_USER_STATE_DIRECTORY`. The replica lock therefore resolves that directory with `realpath` and locks its physical directory. That is safe because nothing is deleted there and every run resolves the same link to the same lock. Runtime retention keeps refusing a linked runtime root, because it deletes inside that root.

The shared lock records its holder as `<pid>\n<birth identity>\n`, using the same birth identity as runtime bindings. A crashed holder's pid can belong to another process later, for example after a WSL restart. A lock whose pid runs but whose birth identity differs under the same identity scheme is stale and is taken over. A dead pid frees the lock as before. A pid-only lock, written by an older CLI or by a holder whose birth could not be observed, is judged by its pid alone, as before. So is a holder whose birth cannot be observed now or uses another identity scheme. An older CLI or runtime, including the `repository-runtime.js` bundled in an older runtime, caps the lock at 64 bytes and refuses the two-line lock with `Unsafe runtime lock.` before judging its pid, both while a new CLI holds it and after a new holder crashes. It fails closed and deletes nothing, and the next new-CLI run clears a stale lock.

`lervo upgrade` runs in different repositories, for example several agents acting on `repository_replica_service_stale_runtime`, share one coordinator. Without the lock, two runs could both pass the re-plan and interleave their stops and starts. A second run waits for the lock, polling every 250 ms, for at most 180 seconds: one graceful stop bound plus a start. It then re-plans inside the lock. Waiting longer fails with `replica_service_busy` and changes nothing.

Inside the lock, apply re-plans and refuses a changed plan with `replica_service_plan_stale`. A coordinator that another run or the manager already restarted onto the current runtime plans `current`, so apply does nothing. Otherwise apply moves `current` first, then restarts.

The new manager action `restart` takes the same canonical arguments as `install` and requires `--write`. It is the existing upgrade transaction with the installed definition as its own predecessor:

1. Verify that the installed bytes equal the canonical definition. Otherwise fail with `service_state_conflict`.
2. Stop through the manager (`launchctl bootout` or `systemctl --user stop`) and wait until it is stably inactive within the graceful stop bound.
3. Rewrite the same bytes and start (`launchctl bootstrap` or `systemctl --user start`).
4. Require the service to stay active, as for an upgrade.

If the restarted service does not stay active, the transaction stops it and starts the same definition again. The failure codes are those of an upgrade: `service_upgrade_failed` when that recovery is verified, and `service_upgrade_unknown` when it is not. The stage fails with that code. A manager result that is not active fails the stage with `replica_service_unavailable`, as for an install.

A Node service never uses `restart`. It restarts only inside its guarded upgrade fence (ADR-0489), so the manager refuses `restart` for `--runtime node` with `invalid_arguments`.

Lervo never signals the process itself. The service manager stops only the job it runs under the Lervo label, so no process Lervo does not own is touched.

### Terminal inspection reports a stale coordinator on every host

The terminal lifecycle inspection from ADR-0628 now runs on macOS and Linux. It finds the installed definition at the path the service renderer owns: `~/Library/LaunchAgents/dev.lervo.repository-replica.plist` or `~/.config/systemd/user/lervo-repository-replica.service`. It makes one manager call: `launchctl print` on macOS, or the same `systemctl --user show --property=MainPID --value` on Linux. It parses the answer with the parsers the service manager uses. It does not import the whole service manager or the Node runtime, so the terminal hook bundle stays within its size budget.

- Unsafe definition: `repository_replica_service_definition_unsafe`, unchanged.
- An unknown user id on macOS, an unreadable definition path, or a failed observation: `repository_replica_service_inspection_failed`. The Stop hook labels this a `lifecycle_inspection_failed` turn, not `knowledge_inspection_failed`, because no knowledge check was skipped. The issue keeps its own code.
- A systemd user manager this shell cannot reach: the advisory `repository_replica_service_manager_unreachable`, remedy `systemctl --user status lervo-repository-replica.service`. The shell has neither `XDG_RUNTIME_DIR` nor `DBUS_SESSION_BUS_ADDRESS`, or `systemctl` is missing or fails. A plain SSH or `su` session looks like this while the coordinator runs fine. The advisory never makes a turn report action required. It appears in the lifecycle inspection's `serviceAdvisories` and in operating attention.
- Not loaded: `repository_replica_service_inactive`. On systemd, a unit with `MainPID` 0 is not loaded, matching the manager's own status. The remedy names `launchctl bootstrap` on macOS and `systemctl --user enable --now lervo-repository-replica.service` on Linux.
- Running but not bound to the runtime `current` names: `repository_replica_service_stale_runtime`, remedy `lervo upgrade`.

A loaded launchd job between restarts runs no process and is not stale. The inspection reports. It never restarts anything.

### Retention keeps a bound runtime

Runtime retention already keeps every runtime directory that a live process is bound to with a matching birth identity. A stale coordinator therefore keeps its old runtime until the restart. After the restart, the old process is absent, so its record no longer protects that runtime. This decision adds no retention rule. Retention and the coordinator check share one record parser. Both judge a record's birth identity only after the record's structure is valid. Retention judges it only while the process is alive, as before, so a malformed record of a dead process never blocks retention. The coordinator check treats a malformed identity as unproven.

### Host symmetry

launchd and systemd hosts use the same binding proof, stage reasons, manager action, and issue codes. Nothing is restricted to one host.

## Events, state, privacy, and failure meaning

- No canonical event is added.
- No host state is added. The binding records already exist, and the check only reads them.
- New upgrade stage reason `replica_service_stale_runtime` with action `restart`. The plan carries no process id, path, or identity. It keeps hashes and the `<hash16>` runtime name only.
- New terminal issue code `repository_replica_service_stale_runtime`. Like the other ADR-0628 codes, it holds no path, command output, process id, or identity. Its meaning: the coordinator process runs, but Lervo could not prove that it loaded the runtime `current` names. It does not mean the coordinator is broken.
- The manager `status` result adds `processId`, a local integer that never leaves the host.
- The manager `restart` result reports `change: "restarted"`.
- New terminal advisory `repository_replica_service_manager_unreachable`, in the new optional lifecycle field `serviceAdvisories`. It holds no path or command output. Its meaning: this shell could not ask the user manager, so nothing is known about the coordinator. It does not mean the coordinator is down.
- New host file `repository-replica-service.lock` and its `.sqlite` guard in the physical user state directory. The lock holds the holder's process id and birth identity, both local to the host, and is removed when the stage ends. The runtime retention lock gains the same birth identity line. A lock left by a dead process, or by one whose pid was reused, is recovered by the next run.
- New apply failure `replica_service_busy`: another replica service change held the host lock for longer than one bounded restart; nothing was changed.

## Compatibility and deploy order

A coordinator started by a payload older than 2026-10-25 has no binding record and is restarted by the first `lervo upgrade` with this decision. After that, it binds itself and is restarted only when `current` moves.

One host's upgrade does not restart the peer host's coordinator. Each host restarts its own at its next `lervo upgrade`.

## Consequences

- A released coordinator fix reaches every host at that host's next `lervo upgrade`, with no manual restart.
- Retention on a host whose coordinator predates bindings stops deferring once the coordinator is restarted.
- A host whose manager cannot report a process id restarts its coordinator at every upgrade and shows `repository_replica_service_stale_runtime` in terminal inspection. That cost is visible, never silent.

## Verification

Focused tests show:

- **Stage:** Two applies of the same stale plan at the same time restart once; the second waits for the lock and returns nothing.
- **Lock:** The holder's birth identity is recorded. A live pid with another birth under the same scheme is taken over at once. A matching birth, an unobservable birth, another scheme, or a pid-only lock stays held. A malformed holder is refused and kept. A replica lock under a linked state directory is taken in the physical directory, while retention still refuses a linked runtime root. An unchanged definition whose process is bound to an older runtime plans `restart` with reason `replica_service_stale_runtime`. Apply restarts it once with the same definition bytes and no predecessor argument, and the next plan is `current`. A process with no record, an unreported id, or a reused id also plans `restart`. A process bound to the current runtime plans `current` and is not restarted. A stopped service plans `activate`. A pointer update plus a stale process moves the pointer, then restarts. A coordinator that restarted onto the current runtime after planning makes apply do nothing.
- **Manager:** Under both systemd and launchd, `status` reports the process id. `restart` stops before it starts, keeps the definition bytes, and yields a new process id. A stopped unit or an unparseable `MainPID` answer reports no id. `restart` refuses a differing definition, a Node service, and a missing `--write`.
- **Inspection:** On both macOS and Linux, a coordinator bound to another runtime, with no reported id, or with a mismatched identity reports `repository_replica_service_stale_runtime`. A loaded job with no process reports nothing. Unloaded services keep their code. A failed observation reports `repository_replica_service_inspection_failed`, and the Stop hook labels it `lifecycle_inspection_failed`. A shell without a user bus gets only the `repository_replica_service_manager_unreachable` advisory, and `systemctl` is never run.
- **Retention:** On both platforms, a coordinator command through `current` with a live binding to an older runtime keeps that runtime after `current` moves. The same runtime is a candidate once its process is gone. A malformed record of a dead process does not block retention; one of a live process still defers it.

No installed host has been restarted by this change.
