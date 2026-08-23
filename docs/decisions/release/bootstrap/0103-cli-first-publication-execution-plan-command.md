# ADR-0103: CLI first-publication execution-plan command

Status: `accepted`
Decision date: 2026-08-21

## Context

The pure plan lacked a safe operator command. Viewing a plan must not perform online checks, reserve, arm, or publish.

## Decision

Add `pnpm release:bootstrap:plan`, requiring absolute publication-authorization and bootstrap paths; `--json` is optional. Read each regular file up to 64 KiB, validate it, build the canonical ADR-0102 plan, and recheck identical bytes immediately before output.

Reject relative, missing, duplicate, unknown, and `--online` arguments before reads. Provide no tarball, registry, profile, reservation, or publisher port. Write only to stdout and create no document.

Default English output clearly shows the target, unarmed and unimplemented status, five execution rechecks, eight steps, two confirmations, three cancellation dispositions, and that no online check, prompt, reservation, arming, or publication occurred. JSON returns only canonical v1. Exit status 0 means that the plan was generated, not that readiness or authority exists.

Exclude input paths, approver, profile, user, configuration, credentials, and external output. Use bounded fixed errors. Share safe snapshot reading with preflight while keeping orchestration, formatting, and argument parsing separate.

## Consequences

Operators can inspect exact execution risk without opening any publication boundary.
