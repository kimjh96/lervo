# Default and strict topology

Omit top-level `repositoryReplica` for the installed default. The always-on Node's repository is the native-work execution source; completion records `replicaDisposition: not_configured`. An external recovery replica cannot block conversation availability. The coordinator may run asynchronously and must preserve divergence for explicit reconciliation.

Set top-level `repositoryReplica.required` to `true` only for a deliberate strict single-writer topology. It requires exact peer parity before native work and after changed work:

- `maximumStalenessMs` bounds readiness receipt staleness.
- `waitTimeoutMs` bounds the total wait.
- `pollIntervalMs` bounds the recheck interval.

Install the external replica coordinator separately with owner-only peer configuration and keep its user service loaded. macOS terminal completion reports an installed but inactive coordinator as action required. A divergent pair fails closed until an operator resolves authority. This is not an availability-safe default for independently edited Mac and WSL worktrees.
