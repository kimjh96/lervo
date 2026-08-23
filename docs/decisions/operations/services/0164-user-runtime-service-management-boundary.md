# ADR-0164: User Runtime Service Management with Explicit Writes

- Status: accepted
- Decision date: 2026-08-22

## Context

Rendered service definitions still required manual installation. Service activation is an external mutation that can start networking and managed commands, so repository implementation and actual host activation must remain distinct.

## Decision

pnpm service:manage supports only Linux systemctl --user and macOS launchctl gui/<uid>, never sudo/system services. Read-only status normalizes managerAvailable, installed, enabled, and active without exposing manager output or paths.

install/remove additionally require a canonical owner-only rendered definition, real absolute executable/config paths, and --write. The source is bounded, no-follow, mode-checked, and byte-equal to fresh renderer output.

Targets are fixed per user: ~/.config/systemd/user/lervo-<hub|node>.service or ~/Library/LaunchAgents/com.lervo.<hub|node>.plist. Different existing bytes cause service_state_conflict without overwrite or stop.

Install exclusively creates a mode-0600 target, reloads/enables/starts, and verifies normalized status. A newly activated service must remain operational across three observations separated by 500 milliseconds; one transient active response is insufficient. Removal permits at most six observations and requires three consecutive stopped observations before deleting the exact definition, so asynchronous manager teardown is not mistaken for failure or completion. Identical already-active bytes return unchanged. New-target failure compensates stop/disable and deletes only after exact-byte recheck. Unverified application or compensation yields service_apply_unknown without retry, deletion, or success claim.

Remove acts only when target equals canonical source, stops/disables, verifies inactive and bytes, then deletes. Missing definitions or differing bytes are never guessed. Upgrades require explicit remove/install; runtime material uses SIGHUP.

Fixed failures separate arguments/authority/manager, source/CAS/conflict, and external apply/remove unknowns. Output excludes manager streams, commands, definitions, secrets, paths, and causes. Service status is observation, not runtime readiness, command execution, or content-use evidence.

## Consequences

Fixtures cover user-only install/status/idempotency/remove, transient activation compensation, transient launchd removal, missing --write, conflicting/symlink sources, launchd compensation, unavailable managers, renderer safety, and signal/restart/umask contracts. A WSL2 user Hub and Mac Node were upgraded through explicit remove/install and separately passed service stability and runtime readiness checks; manager state still does not claim runtime readiness.
