# Compatibility and verification

## Upgrade, rollback, migration, and drift

The evidence binds current tests for reader activation, failed activation, writer rollback, repository upgrade and failed upgrade, knowledge migration idempotence, state-prune recovery, and retrieval drift gates. Old events retain their historical meaning. A stronger provider or retrieval result cannot offset an authority, recovery, privacy, or compatibility failure.

## Verification

```bash
pnpm foundation:recovery:check
pnpm foundation:security:check
pnpm foundation:capacity:check
```

The generated report binds the exact source-byte revision, protocol digest, effect and collection inventories, recovery matrix, telemetry registry digest, threat controls, capacity environments, and hashes of focused runtime suites. Generated JSON, prompts, outputs, credentials, and absolute paths are excluded from the evidence identity.
