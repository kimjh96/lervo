# ADR-0101: CLI first-publication preflight command

Status: `accepted`
Decision date: 2026-08-21

## Context

ADR-0100 defined read-only ports/report but no command composing real release files, reservation store, and npm-account observation. Ad hoc scripts could disagree on paths, stale inputs, credentials, and external failures. Preflight remains advisory and must not share a command with publishing or accumulate result files.

## Decision

Add `pnpm release:bootstrap:preflight` requiring `--online` plus absolute release-directory, publication-authorization, bootstrap, reservation-root, and user-config paths; optional `--json`. Reject missing online/relative/duplicate/unknown arguments before source/external access.

Read bounded regular sources and exact tarball, observe public npm/reservation/profile, then confirm source bytes unchanged before output. Command receives only reservation `observe`, never reserve/terminal/publisher.

Npm observer first checks TTY/non-CI/no auth-token-OTP environment; violations invoke no npm. Then require npm ≥11.5.1 and only `profile get --registry https://registry.npmjs.org --json` using owner-only temp directory/cache/empty global config and explicit existing user config. Compare user-config bytes before/after, cleanup always, and reduce failures to source-free client/profile-unavailable reasons.

Default English output shows Ready/Blocked/Unknown and safe next checks; JSON is report v1. Exit 0 only for all-ready, otherwise 1. Output excludes input paths, profile/user, config, environment names/values, credentials, OTP, npm output/errors.

Write report only to stdout; perform no prompt/reservation/publish/settings change. Temporary cache is not reported as external state. Add no runtime event/project state.

## Consequences

Preflight composes one safe diagnostic path but cannot replace execution-time reobservation, reservation, or human confirmation.
