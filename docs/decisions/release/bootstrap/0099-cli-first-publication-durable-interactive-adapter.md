# ADR-0099: Durable storage and interactive adapter for CLI first publication

Status: `accepted`; ADR-0112 extends reservation v2, ADR-0113 narrows inspection for reconciliation  
Decision date: 2026-08-21

## Context

Process-local reservations cannot prevent republication after restart or a lost response. The first scoped npm publication requires public access and interactive 2FA, but a TTY or successful process cannot prove a second factor was used instead of a bypass token.

## Decision

- Under a configured absolute root, create one mode-`0700` `<reservation-id>/` directory containing only mode-`0600` `reservation.json` and `terminal.json`.
- Reject symlinks, overly broad permissions, files larger than 64 KiB, and invalid JSON. Create the reservation once; even a partial directory fails closed and cannot be reserved again.
- Exclusively write one terminal envelope as `published`, `aborted_before_publication`, or `publication_unknown`, with a canonical digest. Never overwrite or append. Preserve `published` if a late `markUnknown` arrives after a lost response. Sync POSIX file and directory entries or the Windows handle.
- Interactive preparation requires all three TTYs; execution outside CI and GitHub Actions; no npm/pnpm auth, token, or OTP environment; npm ≥11.5.1; a nonpending public-registry profile of `auth-and-writes`; and exact user confirmations of package and version, interactive 2FA, and absence of a bypass token.
- Publish from an isolated cwd and cache with an empty global config, while permitting one explicit existing user config as the authentication source. Fix the tarball, registry, tag, public access, and no-lifecycle-scripts behavior. Pass no OTP or credential argument, inherit the TTY, and capture or store no output.
- After the command, require exact user confirmation that “2FA confirmation completed” before registry-metadata verification. This proves human presence, not npm-signed evidence. Missing confirmation produces an unknown outcome because publication may have occurred.
- Store none of the confirmation, profile, user, config, token, OTP, or command output. Clean up process-local session resources without copying or modifying the user config. The CLI did not yet activate this session.

## Consequences

Fixtures cover restart, duplicate, partial, and corrupt storage; preservation of published state; TTY and environment checks; profiles; and confirmations. They do not prove a real account, challenge, package, or configuration is safe.
