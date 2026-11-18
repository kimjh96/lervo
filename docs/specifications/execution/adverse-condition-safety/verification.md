# Compatibility and verification

## Upgrade, rollback, migration, and drift

The evidence binds current tests for reader activation, failed activation, writer rollback, repository upgrade and failed upgrade, knowledge migration idempotence, state-prune recovery, and retrieval drift gates. Old events retain their historical meaning. A stronger provider or retrieval result cannot offset an authority, recovery, privacy, or compatibility failure.

## Verification

The focused runtime suites of each owning package verify these boundaries through `pnpm test`. [ADR-0560](../../../decisions/foundation/0560-remove-unused-subsystems-to-harden-the-core.md) removed the foundation recovery, security, and capacity commands and their generated report.
