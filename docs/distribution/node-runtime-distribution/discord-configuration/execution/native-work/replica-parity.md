# Optional replica parity and completion

Omit top-level `repositoryReplica` for the installed default: the always-on Node's repository is the native-work execution source, completion records `replicaDisposition: not_configured`, and an external recovery replica cannot block conversation availability. The coordinator may still run asynchronously and must preserve divergence for explicit reconciliation.

Set top-level `repositoryReplica.required` to `true` only for a deliberately strict single-writer topology. It requires exact peer parity before native work and after changed work. `maximumStalenessMs` bounds readiness receipt staleness, `waitTimeoutMs` bounds the total wait, and `pollIntervalMs` bounds the recheck interval. Install the external replica coordinator separately with its owner-only peer configuration and keep its user service loaded; macOS terminal completion reports an installed but inactive coordinator as action required. A divergent pair fails closed until an operator resolves authority—it is not an availability-safe default for independently edited Mac and WSL worktrees.

Coordinator `peer.commandTimeoutMs` bounds each finite SSH operation and defaults to 60 seconds.
`maximumConcurrency` bounds independent reconciliations from one through four. Use one for a
Windows-to-WSL command bridge that cannot safely sustain parallel `wsl.exe` launches. A deadline or
transport failure produces no readiness receipt and cannot occupy a reconciliation slot forever.
Set coordinator `peerWatch` to `false` when that bridge cannot safely retain one SSH/WSL watch
process per repository. Local changes remain event-driven; peer changes are detected with finite
snapshot commands at `pollIntervalMs`, avoiding persistent bridge saturation without weakening
exact snapshot or conflict verification.

While a request waits, the Node rechecks the receipt at least once per second, even with a filesystem watcher. This covers coalesced or lost notifications without an idle full-history poller. Each recheck requires the exact current snapshot and a fresh receipt; a timeout never counts as parity.

A changed turn is published as successful only after the peer receipt reaches the new exact snapshot and the workstream, terminal canonicalization declaration, and repository knowledge lifecycle are current.
