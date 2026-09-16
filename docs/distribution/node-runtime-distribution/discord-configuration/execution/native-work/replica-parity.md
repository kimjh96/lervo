# Replica parity and completion

Top-level `repositoryReplica`, with `required` set to `true`, requires exact peer parity for native work. `maximumStalenessMs` bounds readiness receipt staleness, `waitTimeoutMs` bounds the total wait, and `pollIntervalMs` bounds the recheck interval. Install the external replica coordinator separately with its owner-only peer configuration. Keep its user service loaded for every repository that requires parity; macOS terminal completion reports an installed but inactive coordinator as action required.

Coordinator `peer.commandTimeoutMs` bounds each finite SSH operation and defaults to 60 seconds.
`maximumConcurrency` bounds independent reconciliations from one through four. Use one for a
Windows-to-WSL command bridge that cannot safely sustain parallel `wsl.exe` launches. A deadline or
transport failure produces no readiness receipt and cannot occupy a reconciliation slot forever.

While a request waits, the Node rechecks the receipt at least once per second, even with a filesystem watcher. This covers coalesced or lost notifications without an idle full-history poller. Each recheck requires the exact current snapshot and a fresh receipt; a timeout never counts as parity.

A changed turn is published as successful only after the peer receipt reaches the new exact snapshot and the workstream, terminal canonicalization declaration, and repository knowledge lifecycle are current.
