# ADR-0511: Tell a loaded launchd job from a running one

Status: `accepted`
Decision date: 2026-10-13
Amends: [ADR-0164](0164-user-runtime-service-management-boundary.md)

## Context

On the Mac, argo's repository Node stopped on 2026-10-12 and never came back. Its launchd job uses `KeepAlive.SuccessfulExit = false`, so after a clean exit it stayed loaded in `state = not running`. Every later `lervo upgrade` then failed its Node stage with `service_upgrade_fence_invalid: no running Node session holds this work scope`.

Service status set `active` from the exit status of `launchctl print`. That command exits 0 for any loaded job, running or not. The stopped job therefore looked active, and two of ADR-0164's rules did not hold for it:

- **Inactive recovery.** An exact installed service with a stable inactive state may be upgraded without a live work session. Because the loaded job looked active, this recovery never applied, and the upgrade waited for a session that could not exist.
- **Repeated install.** Installing identical, already active bytes returns `unchanged`. Because the stopped job looked active, a repeated install returned `unchanged` without starting it.

Under systemd, `is-active` already reports the process state.

## Decision

Service status reports `loaded` and `active` separately:

- Under launchd, `loaded` means `launchctl print` succeeds. `active` additionally requires the job's own top-level state line, indented by one tab, to read `state = running`.
- Under systemd, `loaded` mirrors `active`, so systemd behavior is unchanged.

Each decision uses the property it is about:

- Whether a process can hold admitted work, as in inactive recovery and operational checks, uses `active`.
- Whether a job must be booted out, or its definition may be replaced or removed, uses `loaded`.
- Installing over a loaded job that is not running starts it with `launchctl kickstart` instead of bootstrapping it twice.
- Upgrading such a job boots it out and verifies that it is unloaded before bootstrapping the replacement.

`launchctl print` output is read with a 64 KiB bound only for this status query. Manager output stays out of normalized status.

## Consequences

A launchd Node whose process exited cleanly can be upgraded in place and returns to running. Re-installing its identical definition restarts it. The live-session fence still refuses every other missing or conflicting session.
