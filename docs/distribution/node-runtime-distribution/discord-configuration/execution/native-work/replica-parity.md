# Replica parity and completion

Top-level `repositoryReplica` requires exact peer parity for native work, with `required` set to `true`. `maximumStalenessMs` bounds readiness receipt staleness, `waitTimeoutMs` bounds the total wait, and `pollIntervalMs` bounds the recheck interval. Install the external replica coordinator separately with its owner-only peer configuration.

While a request is waiting, the Node rechecks the receipt at least once per second even when a filesystem watcher is available. This covers coalesced or lost notifications without an idle full-history poller. A recheck still requires the exact current snapshot and fresh receipt; it never treats a timeout as parity.

A changed turn is not published as successful until the peer receipt reaches the new exact snapshot and the workstream, terminal canonicalization declaration, and repository knowledge lifecycle are current.
