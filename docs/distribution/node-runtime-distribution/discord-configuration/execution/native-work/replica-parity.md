# Replica parity and completion

Top-level `repositoryReplica`, with `required` set to `true`, requires exact peer parity for native work. `maximumStalenessMs` bounds readiness receipt staleness, `waitTimeoutMs` bounds the total wait, and `pollIntervalMs` bounds the recheck interval. Install the external replica coordinator separately with its owner-only peer configuration.

While a request waits, the Node rechecks the receipt at least once per second, even with a filesystem watcher. This covers coalesced or lost notifications without an idle full-history poller. Each recheck requires the exact current snapshot and a fresh receipt; a timeout never counts as parity.

A changed turn is published as successful only after the peer receipt reaches the new exact snapshot and the workstream, terminal canonicalization declaration, and repository knowledge lifecycle are current.
