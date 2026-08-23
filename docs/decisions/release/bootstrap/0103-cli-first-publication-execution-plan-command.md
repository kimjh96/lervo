# ADR-0103: CLI first-publication execution-plan command

Status: `accepted`
Decision date: 2026-08-21

## Context

The pure plan lacked a safe operator command. Plan viewing must not perform online checks, reserve, arm, or publish.

## Decision

Add `pnpm release:bootstrap:plan` requiring absolute publication-authorization and bootstrap paths plus optional `--json`. Read each regular file up to 64 KiB, validate, build canonical ADR-0102 plan, and recheck identical bytes immediately before output.

Reject relative/missing/duplicate/unknown/`--online` arguments before reads. Provide no tarball, registry, profile, reservation, or publisher port. Output stdout only and create no document.

Default English output clearly shows target, unarmed/unimplemented status, five execution rechecks, eight steps/two confirmations, three cancellation dispositions, and that no online check/prompt/reservation/arming/publish occurred. JSON returns only canonical v1. Exit 0 means plan generated, not readiness/authority.

Exclude input paths, approver/profile/user/config/credentials/external output. Use bounded fixed errors. Share safe snapshot reading with preflight while separating orchestration, formatting, and argument parsing.

## Consequences

Operators can inspect exact execution risk without opening any publication boundary.
