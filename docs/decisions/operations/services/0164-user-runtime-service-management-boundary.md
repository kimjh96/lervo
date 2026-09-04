# ADR-0164: User Runtime Service Management with Explicit Writes

- Status: accepted
- Decision date: 2026-08-22

## Context

Rendered service definitions required manual installation. Because activation can start networking and managed commands, repository implementation and host activation must remain separate.

## Decision

`pnpm service:manage` supports only Linux `systemctl --user` and macOS `launchctl gui/<uid>`. It never uses `sudo` or system services. Read-only status normalizes `managerAvailable`, `installed`, `enabled`, and `active` without exposing manager output or paths.

`install` and `remove` require `--write`, a canonical owner-only rendered definition, and real absolute executable and configuration paths. The source must be bounded, no-follow, mode-checked, and byte-equal to fresh renderer output.

Standalone JavaScript runtimes may bind `--node-executable <absolute-path>`. When present, the canonical service command is the exact Node executable followed by the runtime entry point and configuration argument. The Node executable must be a real executable regular file. The JavaScript entry point must be a real regular file but need not have an executable bit. Omitting the option preserves the direct-executable contract. This avoids ambient `PATH` and shebang resolution without embedding Node in the standalone distribution or introducing a runtime-specific wrapper lifecycle. The renderer composes the command; the manager only validates and applies the exact rendered bytes.

Per-user Hub targets are fixed:

- `~/.config/systemd/user/lervo-hub.service`
- `~/Library/LaunchAgents/com.lervo.hub.plist`

[ADR-0202](0202-repository-node-fleet-identity-and-registry.md) replaces the global Node target with a required repository-node instance identity: `lervo-node-<instance>.service` or `com.lervo.node.<instance>`. Existing legacy global Node definitions are never automatically overwritten, stopped, or removed.

Different existing bytes cause `service_state_conflict`; the command neither overwrites nor stops the service.

Installation exclusively creates a mode-0600 target, reloads, enables, starts, and verifies normalized status. A newly activated service must remain operational across three observations separated by 500 milliseconds; one transient active response is insufficient. Removal permits at most six observations and requires three consecutive stopped observations before deleting the exact definition, preventing asynchronous manager teardown from being mistaken for failure or completion.

Identical, already-active bytes return unchanged. Failure for a new target compensates by stopping and disabling, then deletes only after an exact-byte recheck. Unverified application or compensation returns `service_apply_unknown` without retry, deletion, or a success claim.

Removal acts only when the target equals the canonical source. It stops and disables the service, verifies inactivity and bytes, then deletes the definition. Missing or differing definitions are never guessed. A transactional upgrade binds both exact predecessor and replacement definitions, accepts either a stably operational predecessor or its exact inactive installed form, and restores the predecessor's prior disposition if replacement activation fails. Runtime material uses `SIGHUP` only where the runtime explicitly supports reload.

Fixed failures distinguish argument, authority, manager, source, CAS, conflict, and unknown external apply or removal errors. A missing, non-executable, or symlinked Node executable fails before any service-manager call. Output excludes manager streams, commands, definitions, secrets, paths, and causes. Absolute paths remain only in the owner-only service definition. Service status is an observation, not evidence of runtime readiness, command execution, or content use.

## Consequences

Fixtures cover user-only install, status, idempotency, removal, active and inactive transactional upgrades, rollback, transient activation compensation, transient launchd removal, missing `--write`, conflicting or symlinked sources, launchd compensation, unavailable managers, renderer safety, and signal, restart, and umask contracts.

A WSL2 user Hub and Mac Node were upgraded through explicit remove and install operations and separately passed service-stability and runtime-readiness checks. Manager state still does not establish runtime readiness.
