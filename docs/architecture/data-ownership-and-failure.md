# Data Ownership and Failure Boundaries

Status: `active`
As of: 2026-08-27

## Data ownership

| Data | Canonical owner | Sync default |
| --- | --- | --- |
| Repository files and tracked Lervo policy | Git repository | User-controlled |
| Local event chain and CAS | Project node | Off |
| Generated knowledge indexes | Rebuildable from tracked sources | Git-capable |
| Credentials and mutable observations | Local runtime | Never as source docs |
| Repository Node fleet registry | User-local deployment state | Never; contains no credentials |
| Hub read models and command queue | Hub | Explicitly authorized |
| Capability packages and derived lock | Project or user local storage | Off; explicit Hub publish only |

## Failure posture

- Invalid contracts fail closed.
- Uncertain external effects are not automatically retried as if nothing happened.
- Event failure before commit rolls back a managed write.
- Failure after a committed event preserves exact output and requires recovery.
- Missing telemetry lowers assurance and never upgrades a claim.

## References

- [System architecture](system.md)
- [Execution and evidence specification](../specifications/execution.md)
