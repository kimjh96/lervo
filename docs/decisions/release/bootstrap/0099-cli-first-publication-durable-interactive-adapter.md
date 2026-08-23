# ADR-0099: Durable storage and interactive adapter for CLI first publication

Status: `accepted`; ADR-0112 extends reservation v2, ADR-0113 narrows inspection for reconciliation
Decision date: 2026-08-21

## Context

Process-local reservations cannot prevent republish after restart/lost response. npm first scoped publish needs public access and interactive 2FA, but TTY or process success cannot prove a second factor rather than a bypass token.

## Decision

- Under configured absolute root, create one mode-`0700` `<reservation-id>/` with mode-`0600` `reservation.json` and `terminal.json` only.
- Reject symlinks, broad permissions, >64 KiB, invalid JSON. Create reservation once; even a partial directory is fail-closed and cannot re-reserve.
- Write one terminal envelope exclusively as `published`, `aborted_before_publication`, or `publication_unknown` plus canonical digest. Never overwrite/append. Preserve published if a late `markUnknown` arrives after lost response. Sync POSIX file/directory entries or Windows handle.
- Interactive preparation requires all three TTYs, non-CI/GitHub Actions, no npm/pnpm auth/token/OTP environment, npm ≥11.5.1, nonpending public-registry profile `auth-and-writes`, and exact user confirmations of package/version, interactive 2FA, and no bypass token.
- Publish from isolated cwd/cache/empty global config while allowing one explicit existing user config as auth source. Fix tar/registry/tag/public access/no lifecycle scripts; pass no OTP/credential argument; inherit TTY and capture/store no output.
- After command, require exact “2FA confirmation completed” user confirmation before registry metadata verification. This is human presence, not npm-signed proof. Missing confirmation becomes unknown because publication may have occurred.
- Store none of confirmation/profile/user/config/token/OTP/output. Cleanup process-local session resources without copying/modifying user config. CLI did not yet activate this session.

## Consequences

Fixtures cover restart, duplicate/partial/corrupt storage, published preservation, TTY/environment/profile/confirmations, but prove no real account/challenge/package/config safety.
