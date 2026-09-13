# Replica parity and completion

Top-level `repositoryReplica` requires exact peer parity for native work. `required` must be `true`. `maximumStalenessMs` bounds readiness receipt staleness, `waitTimeoutMs` bounds the total wait, and `pollIntervalMs` bounds the recheck interval. The external replica coordinator must be installed separately with its owner-only peer configuration.

A changed turn is not published as successful until the peer receipt reaches the new exact snapshot and the workstream, terminal canonicalization declaration, and repository knowledge lifecycle are current.
