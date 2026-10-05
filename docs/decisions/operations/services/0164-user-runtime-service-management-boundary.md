# ADR-0164: User Runtime Service Management with Explicit Writes

- Status: accepted
- Decision date: 2026-08-22
- Provider child environment amendment: 2026-09-09
- Requested runtime amendment: 2026-09-19
- Graceful-stop command amendment: 2026-09-24
- Supervised-upgrade owner-fence amendment: 2026-09-24
- Node work-admission amendment: 2026-09-24
- Parsed standing-coordinate compatibility amendment: 2026-09-27
- Frozen CLI configuration replacement amendment: 2026-09-28
- Shared Discord channel binding amendment: 2026-09-28
- Asynchronous launchd stop and retained admission scope amendment: 2026-10-05

## Context

Rendered service definitions required manual installation. Activation can start networking and managed commands, so repository implementation and host activation must remain separate.

## Decision

### Scope and authority

`pnpm service:manage` supports only Linux `systemctl --user` and macOS `launchctl gui/<uid>`, never `sudo` or system services. Read-only status normalizes `managerAvailable`, `installed`, `enabled`, and `active` without exposing manager output or paths.

`install` and `remove` require `--write`, a canonical owner-only rendered definition, and real absolute executable and configuration paths. The source must be bounded, no-follow, mode-checked, and byte-equal to fresh renderer output.

### Runtime and provider commands

Standalone JavaScript runtimes may bind `--node-executable <absolute-path>`. The canonical command then consists of that exact Node executable, runtime entry point, and configuration argument. Node must be a real executable regular file; the JavaScript entry point must be a real regular file but need not be executable. Without this option, the direct-executable contract remains.

Repository Node service inspection reads direct-execution and explicit Node-plus-entry-point definitions for systemd and launchd. It retains separate interpreter and runtime coordinates, binds the complete definition hash, and rejects relative paths, additional arguments, duplicate invocation declarations, unsafe permissions, and changed source bytes. Reading coordinates grants no execution or writer authority.

The renderer avoids ambient `PATH` and shebang resolution without embedding Node in the standalone distribution or adding a runtime-specific wrapper lifecycle. It composes the command and deterministic service `PATH`: bound Node executable directory, runtime directory, then only standard system executable directories. The manager validates and applies only exact rendered bytes. Explicitly configured JavaScript provider launchers can resolve the same bound Node runtime without an interactive-shell path.

Provider adapters preserve the host environment and prepend the running Node executable's directory to each child process path. Independently of service rendering, a configured Codex or Claude entrypoint using `#!/usr/bin/env node` must start identically from an interactive shell, systemd, or launchd. The adapter does not guess another runtime, rewrite the configured provider executable, or publish environment values.

### Targets and conflicts

Fixed per-user Hub targets are:

- `~/.config/systemd/user/lervo-hub.service`
- `~/Library/LaunchAgents/com.lervo.hub.plist`

[ADR-0202](0202-repository-node-fleet-identity-and-registry.md) replaces the global Node target with required repository-node instance identity: `lervo-node-<instance>.service` or `com.lervo.node.<instance>`. Legacy global Node definitions are never automatically overwritten, stopped, or removed.

Different existing bytes yield `service_state_conflict`; the command neither overwrites nor stops the service.

### Requested runtimes are not installed services

Development previews, local application servers, and other conversation-requested runtimes have different lifetimes from the Hub and repository Node. A provider turn's need does not authorize installation, boot enablement, or unconditional restart.

An authorized conversation deployment may expose configured `requested_runtime_open` and `requested_runtime_close` effects. Each target binds an opaque runtime ID, human display name, exact absolute executable, bounded arguments, working directory, optional credential-free loopback HTTP readiness URL, startup and stop deadlines, and maximum lifetime. Configuration contains no secrets. Effect arguments select only one configured runtime ID; provider text cannot supply commands, paths, URLs, environment variables, or restart policies.

The repository Node owns the child independently of the provider turn. Transient states `closed`, `starting`, `open`, `stopping`, and `exited` remain process-local and contain only configured runtime ID, process handle, and lifetime timer. No new durable event is emitted. `open` means spawning succeeded and any configured loopback readiness check passed. Duplicate open is unchanged.

Explicit close, maximum lifetime, or orderly Node shutdown stops the whole process group. Unexpected exit removes the active handle and never automatically restarts; restarting requires another admitted open request. Repository Node restart neither reconstructs nor reopens prior requested runtimes.

The child inherits the Node service environment with the configured executable's directory prepended to existing `PATH`. An absolute package-manager entrypoint can resolve the same package manager in nested lifecycle scripts without an interactive shell or application-specific command knowledge in Lervo.

Start failure retains no active runtime. Readiness timeout stops the process before returning failure. Stop failure is a terminal action failure and cannot be reported as closed. After successful or unchanged action, the adapter returns only configured display label, bounded result code, and privacy-safe observed facts to the same agent's managed conversation responder. The responder explains the completed result naturally from the original message and prior turns, without an action-specific canned reply or invented execution evidence. This boundary neither replaces durable Lervo infrastructure service installation nor turns arbitrary provider shell commands into host-managed processes.

### Installation and removal

Installation exclusively creates a mode-0600 target, reloads, enables, starts, and verifies normalized status. New activation must remain operational across three observations separated by 500 milliseconds; one transient active response is insufficient. Identical, already-active bytes return unchanged.

New-target failure compensates by stopping and disabling, then deleting only after exact-byte recheck. Unverified application or compensation returns `service_apply_unknown` without retry, deletion, or success claim.

Removal requires target bytes equal to the canonical source. It stops and disables, verifies inactivity and bytes, then deletes the exact definition. Before deletion, three consecutive stopped observations 500 milliseconds apart are required within an observation bound spanning the canonical 120-second graceful stop. This prevents asynchronous teardown from being mistaken for failure or completion. Missing or differing definitions are never guessed.

### Transactional upgrades and graceful stop

Transactional upgrade binds exact predecessor and replacement definitions, accepts a stably operational predecessor or its exact inactive installed form, and restores the predecessor's prior disposition if replacement activation fails. Runtime material uses `SIGHUP` only where the runtime explicitly supports reload.

The manager command deadline for stop, bootout, or stop-bearing disable exceeds canonical systemd `TimeoutStopSec=120s` by a bounded margin. Command-level stop failure does not prove continued activity: upgrade reobserves stable inactivity before changing definition bytes. Proven inactivity continues the exact predecessor-bound transaction; otherwise no replacement is published. A previously operational service must not remain down solely because a manager command timed out during normal graceful shutdown.

`launchctl bootout` returns while the job still handles `SIGTERM`; until exit, `print` succeeds and `bootstrap` fails with error 5. Upgrade therefore observes stop within the same 120-second bound.

### Supervision owner fencing

For Nodes with configured outcome supervision, upgrade and rollback acquire the repository-local, cross-process supervision owner lease used by a cycle before any service-manager stop. Standing supervision resolves the verified latest successor binding, locks its current ID and next possible successor ID, and rechecks lineage under both locks. A root-ID-only guard could miss the running successor or concurrent successor installation.

A busy lease yields `service_upgrade_supervision_busy` and leaves the installed service untouched. Malformed or unreadable owner-only configuration or lease state yields `service_upgrade_fence_invalid`. Leases remain held through replacement activation or restoration, then release, preventing supervised cycles from racing stop. The manager reads only required repository and owner coordinates from configuration and emits neither credentials nor paths. Hub operations and Nodes without outcome supervision retain the prior path.

Normal Node shutdown stops scheduling supervision cycles and waits for an in-flight cycle before signalling adapters to stop. This protects supervised effects, not independently managed conversation turns; broader all-work drain remains a separate acceptance boundary.

The upgrade reader accepts raw `standing` root objects and startup-parser `standing: true` plus `binding` root forms. Both resolve and fence the same current and next-successor coordinates; other mixed forms fail before service effects. Compatibility permits neither running configuration-path replacement nor work-admission bypass.

### Configuration binding during upgrades

In-place Node upgrade retains the predecessor service's exact configuration path. The manager extracts it from the exact predecessor definition and refuses unreadable or changed coordinates before any manager command. Guarding replacement configuration alone could miss predecessor-owned active work. Configuration-path migration requires a separately reviewed multi-owner transition, outside this single-config transaction.

The [guarded configuration binding contract](../../../distribution/node-runtime-distribution/installation-and-readiness/cli-binding-upgrades.md) permits either exact replacement of deliberation CLI references and supervised `managedExecution.cliBundle`, or one already shared Discord channel binding at the same path under existing owner leases and work freeze. It defines verified-stop ordering, frozen-digest CAS, exact restoration, bounded private journal fields, and failure meanings. An organization-bound channel addition also requires corresponding canonical external-agent deployment and channel membership rebind after stop, with predecessor rebind on rollback; the configuration adapter does not write those events. No other configuration authority changes.

### Node work admission

Node and service manager share an owner-only SQLite work-admission store under the configured repository root. The exact absolute configuration path hashes to `scope`; exact owner-only configuration bytes hash to `config_digest`.

A running Node registers one `node_work_session` containing random session token, scope, and owner PID. Each admitted conversation, direct interaction, independent result-delivery operation, and remote-command cycle holds a `node_work_claim` with random claim token and session token until settlement.

Manager upgrade or rollback atomically checks the exact live session and absence of claims, then records a `node_work_scope` freeze containing scope, config digest, random freeze token, and manager PID. For an exact installed service with stable inactive state, a previously registered scope with the same configuration digest may also be frozen after dead-session cleanup leaves zero sessions and claims. Never-registered Nodes, conflicting digests, and live claims cannot use this recovery path.

Frozen Node work waits without beginning its effect. The manager holds the freeze through replacement activation or recovery, then releases only its own token. Separate supervision owner leases still guard owner cycles; neither mechanism substitutes for the other.

Rows contain no message, provider output, token usage, credential, or raw configuration. Scope and configuration digests, random tokens, and PIDs remain local in owner-controlled storage; no new repository event is emitted.

A live claim yields `service_upgrade_work_busy` before any stop. Unregistered or conflicting Node, unreadable source, schema mismatch, or missing exact session outside verified inactive recovery yields `service_upgrade_fence_invalid`, also before any stop. Lost freeze release yields `service_upgrade_unknown`, never success. Dead-process rows may be reclaimed only after process-liveness checks.

An older installed Node unable to register a session is not silently idle: its first protocol transition requires a separately reviewed maintenance and deployment procedure. An inactive legacy Node is likewise ineligible for guarded in-place upgrade merely because the manager reports it stopped.

At startup, `admission_invalid` means owner-only path, scope, stored digest, schema, or state failed validation; missing configuration-source digest yields `invalid_config`. `admission_session_busy` means another live Node owns the exact scope. None starts a second participating runtime.

During operation, `admission_claim_lost` means session or claim disappeared unexpectedly; the operation fails and cannot become a successful effect. A manager freeze holds at most 256 new operations in process-local retry waiters until release or shutdown. Excess work fails admission as saturated without starting effects; shutdown rejects waiters as admission closed.

The database retains only current scope, session, claim, and freeze rows, with no appended per-operation history. Session cleanup retains the scope row as participation record, preserving gracefully stopped Nodes' eligibility for verified-inactive recovery. Dead-owner recovery removes orphaned claims.

### Failures, privacy, and evidence

Fixed failures distinguish argument, authority, manager, source, CAS, conflict, and unknown external apply or removal errors. Missing, non-executable, or symlinked Node executables fail before any service-manager call.

Output excludes manager streams, commands, definitions, secrets, paths, and causes. Absolute paths remain only in the owner-only service definition. Service status is an observation, not evidence of runtime readiness, command execution, or content use.

## Consequences

Fixtures cover user-only install, status, idempotency, removal, active and inactive transactional upgrades, rollback, transient activation compensation, transient launchd removal, missing `--write`, conflicting or symlinked sources, launchd compensation, unavailable managers, renderer safety, and signal, restart, and umask contracts.

Owner-fence fixtures prove busy-cycle refusal before manager commands, cross-connection lock exclusion, exact binding selection, release after failed replacement, and supervisor close ordering. Installed proof still requires a busy live-cycle upgrade attempt followed by a clean idle upgrade.

Work-admission fixtures prove cross-connection active-claim refusal, idle freeze exclusion, exact release, source-binding conflict, dead-owner recovery, and Node session lifecycle. Installed busy/idle evidence and the first legacy-node transition remain open acceptance work.

A WSL2 user Hub and Mac Node were upgraded through explicit remove and install operations and separately passed service-stability and runtime-readiness checks. Manager state still does not establish runtime readiness.
