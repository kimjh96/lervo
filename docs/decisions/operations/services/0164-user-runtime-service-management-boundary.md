# ADR-0164: User Runtime Service Management with Explicit Writes

- Status: accepted
- Decision date: 2026-08-22

## Context

Rendered service definitions still required manual installation. Service activation is an external mutation that can start networking and managed commands, so repository implementation and host activation must remain separate.

## Decision

`pnpm service:manage` supports only Linux `systemctl --user` and macOS `launchctl gui/<uid>`. It never uses `sudo` or system services. Read-only status normalizes `managerAvailable`, `installed`, `enabled`, and `active` without exposing manager output or paths.

`install` and `remove` additionally require `--write`, a canonical owner-only rendered definition, and real absolute executable and configuration paths. The source is bounded, no-follow, mode-checked, and byte-equal to fresh renderer output.

Per-user targets are fixed:

- `~/.config/systemd/user/lervo-<hub|node>.service`
- `~/Library/LaunchAgents/com.lervo.<hub|node>.plist`

Different existing bytes cause `service_state_conflict`; the command neither overwrites nor stops the service.

Installation exclusively creates a mode-0600 target, reloads, enables, starts, and verifies normalized status. A newly activated service must remain operational across three observations separated by 500 milliseconds; one transient active response is insufficient. Removal permits at most six observations and requires three consecutive stopped observations before deleting the exact definition, preventing asynchronous manager teardown from being mistaken for failure or completion.

Identical, already-active bytes return unchanged. Failure for a new target compensates by stopping and disabling, then deletes only after an exact-byte recheck. Unverified application or compensation returns `service_apply_unknown` without retry, deletion, or a success claim.

Removal acts only when the target equals the canonical source. It stops and disables the service, verifies inactivity and bytes, then deletes the definition. Missing or differing definitions are never guessed. Upgrades require explicit remove and install operations; runtime material uses `SIGHUP`.

Fixed failures distinguish argument, authority, manager, source, CAS, conflict, and unknown external apply or removal errors. Output excludes manager streams, commands, definitions, secrets, paths, and causes. Service status is an observation, not evidence of runtime readiness, command execution, or content use.

## Consequences

Fixtures cover user-only install, status, idempotency, removal, transient activation compensation, transient launchd removal, missing `--write`, conflicting or symlinked sources, launchd compensation, unavailable managers, renderer safety, and signal, restart, and umask contracts.

A WSL2 user Hub and Mac Node were upgraded through explicit remove and install operations and separately passed service-stability and runtime-readiness checks. Manager state still does not establish runtime readiness.
