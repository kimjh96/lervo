# ADR-0164: User Runtime Service Management with Explicit Writes

- Status: accepted
- Decision date: 2026-08-22
- Provider child environment amendment: 2026-09-09
- Requested runtime amendment: 2026-09-19

## Context

Rendered service definitions required manual installation. Because activation can start networking and managed commands, repository implementation and host activation must remain separate.

## Decision

### Scope and authority

`pnpm service:manage` supports only Linux `systemctl --user` and macOS `launchctl gui/<uid>`. It never uses `sudo` or system services. Read-only status normalizes `managerAvailable`, `installed`, `enabled`, and `active` without exposing manager output or paths.

`install` and `remove` require `--write`, a canonical owner-only rendered definition, and real absolute executable and configuration paths. The source must be bounded, no-follow, mode-checked, and byte-equal to fresh renderer output.

### Runtime and provider commands

Standalone JavaScript runtimes may bind `--node-executable <absolute-path>`. When supplied, the canonical service command is the exact Node executable followed by the runtime entry point and configuration argument. The Node executable must be a real executable regular file. The JavaScript entry point must be a real regular file but need not be executable. Omitting the option preserves the direct-executable contract.

Repository Node service inspection reads direct-execution and explicit Node-plus-entry-point definitions for systemd and launchd. It retains the interpreter and runtime as separate coordinates, binds the complete definition hash, and rejects relative paths, additional arguments, duplicate invocation declarations, unsafe file permissions, and changed source bytes. Reading these coordinates grants no execution or writer authority.

This avoids ambient `PATH` and shebang resolution without embedding Node in the standalone distribution or adding a runtime-specific wrapper lifecycle. The renderer composes the command and a deterministic service `PATH` that starts with the bound Node executable directory and runtime directory, followed only by standard system executable directories. The manager validates and applies only the exact rendered bytes. This service environment lets explicitly configured JavaScript provider launchers resolve the same bound Node runtime without inheriting an interactive-shell path.

Provider adapters also preserve the host environment and prepend the directory of the currently running Node executable to each child process path. This child-boundary guarantee remains independent of service rendering: a configured Codex or Claude entrypoint using `#!/usr/bin/env node` must start identically from an interactive shell, systemd, or launchd. The adapter does not guess another runtime, rewrite the configured provider executable, or publish environment values.

### Targets and conflicts

Per-user Hub targets are fixed:

- `~/.config/systemd/user/lervo-hub.service`
- `~/Library/LaunchAgents/com.lervo.hub.plist`

[ADR-0202](0202-repository-node-fleet-identity-and-registry.md) replaces the global Node target with a required repository-node instance identity: `lervo-node-<instance>.service` or `com.lervo.node.<instance>`. Legacy global Node definitions are never automatically overwritten, stopped, or removed.

Different existing bytes cause `service_state_conflict`; the command neither overwrites nor stops the service.

### Requested runtimes are not installed services

A development preview, local application server, or other runtime requested through a conversation has a different lifetime from the Hub and repository Node. It must not be installed, enabled at boot, or configured with unconditional restart merely because one provider turn needs it.

An authorized conversation deployment may expose configured `requested_runtime_open` and `requested_runtime_close` effects. Each target binds an opaque runtime ID, human display name, exact absolute executable, bounded arguments, working directory, optional credential-free loopback HTTP readiness URL, startup and stop deadlines, and a maximum lifetime. Configuration contains no secret values. The effect argument selects only one configured runtime ID; provider text cannot supply a command, path, URL, environment variable, or restart policy.

The repository Node owns the child process independently of the provider turn. Its transient states are `closed`, `starting`, `open`, `stopping`, and `exited`; they remain process-local and contain only the configured runtime ID, process handle, and lifetime timer. No new durable event is emitted. `open` means the process spawned and, when configured, its loopback readiness check succeeded. Duplicate open is unchanged. Explicit close, maximum lifetime, or orderly Node shutdown stops the whole process group. An unexpected exit removes the active handle and never restarts automatically. A later start requires another admitted open request. Restarting the repository Node does not reconstruct or reopen prior requested runtimes.

The child inherits the Node service environment with the configured executable's directory prepended to the existing `PATH`. This lets an absolute package-manager entrypoint resolve the same package manager from nested lifecycle scripts without inheriting an interactive shell or adding application-specific command knowledge to Lervo.

Start failure means no active runtime is retained. Readiness timeout compensates by stopping the process before returning failure. Stop failure is a terminal action failure and cannot be reported as closed. After a successful or unchanged action, the adapter returns only the configured display label, bounded result code, and privacy-safe observed facts to the same agent's managed conversation responder. That responder explains the already-completed result naturally from the original message and prior turns; it does not expose an action-specific canned reply or let the provider invent execution evidence. This boundary does not replace durable service installation for Lervo infrastructure and does not turn arbitrary provider shell commands into host-managed processes.

### Installation, removal, and upgrades

Installation exclusively creates a mode-0600 target, reloads, enables, starts, and verifies normalized status. A newly activated service must remain operational across three observations separated by 500 milliseconds; one transient active response is insufficient. Identical, already-active bytes return unchanged.

Failure for a new target compensates by stopping and disabling, then deletes only after an exact-byte recheck. Unverified application or compensation returns `service_apply_unknown` without retry, deletion, or a success claim.

Removal acts only when the target equals the canonical source. It stops and disables the service, verifies inactivity and bytes, then deletes the exact definition. It permits at most six observations and requires three consecutive stopped observations before deletion, preventing asynchronous manager teardown from being mistaken for failure or completion. Missing or differing definitions are never guessed.

A transactional upgrade binds both exact predecessor and replacement definitions, accepts either a stably operational predecessor or its exact inactive installed form, and restores the predecessor's prior disposition if replacement activation fails. Runtime material uses `SIGHUP` only where the runtime explicitly supports reload.

### Failures, privacy, and evidence

Fixed failures distinguish argument, authority, manager, source, CAS, conflict, and unknown external apply or removal errors. A missing, non-executable, or symlinked Node executable fails before any service-manager call.

Output excludes manager streams, commands, definitions, secrets, paths, and causes. Absolute paths remain only in the owner-only service definition. Service status is an observation, not evidence of runtime readiness, command execution, or content use.

## Consequences

Fixtures cover user-only install, status, idempotency, removal, active and inactive transactional upgrades, rollback, transient activation compensation, transient launchd removal, missing `--write`, conflicting or symlinked sources, launchd compensation, unavailable managers, renderer safety, and signal, restart, and umask contracts.

A WSL2 user Hub and Mac Node were upgraded through explicit remove and install operations and separately passed service-stability and runtime-readiness checks. Manager state still does not establish runtime readiness.
