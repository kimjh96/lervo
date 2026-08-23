# ADR-0101: CLI first-publication preflight command

Status: `accepted`
Decision date: 2026-08-21

## Context

ADR-0100 defined read-only ports and a report, but no command composed real release files, the reservation store, and npm-account observation. Ad hoc scripts could disagree about paths, stale inputs, credentials, and external failures. Preflight remains advisory, must not share a command with publishing, and must not accumulate result files.

## Decision

Add `pnpm release:bootstrap:preflight`. It requires `--online` and absolute paths for the release directory, publication authorization, bootstrap, reservation root, and user configuration; `--json` is optional. Reject missing online, relative, duplicate, or unknown arguments before accessing sources or external systems.

Read bounded regular sources and the exact tarball, observe public npm state, reservation state, and profile state, then confirm that source bytes remain unchanged before output. The command receives only reservation `observe`, never reserve, terminal, or publisher capabilities.

The npm observer first verifies TTY, non-CI, and absence of auth-token or OTP environment data. Violations invoke no npm command. It then requires npm >=11.5.1 and runs only `profile get --registry https://registry.npmjs.org --json`, using an owner-only temporary directory and cache, an empty global configuration, and the explicit existing user configuration. Compare user-configuration bytes before and after, always clean up, and reduce failures to source-free client-unavailable or profile-unavailable reasons.

Default English output shows Ready, Blocked, or Unknown with safe next checks. JSON output is report v1. Exit status is 0 only when every check is ready; otherwise it is 1. Output excludes input paths, profile, user, configuration, environment names and values, credentials, OTP, and npm output or errors.

Write the report only to stdout. Do not prompt, reserve, publish, or change settings. The temporary cache is not reported as external state. Add no runtime event or project state.

## Consequences

Preflight provides one safe diagnostic path but cannot replace execution-time reobservation, reservation, or human confirmation.
