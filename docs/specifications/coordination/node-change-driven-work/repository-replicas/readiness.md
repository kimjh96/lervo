# Readiness

Replica readiness is opt-in for native conversation work. The installed always-on Node normally executes from its own repository and leaves replication asynchronous. A divergent Mac recovery copy remains available for explicit reconciliation without blocking ordinary work. When `repositoryReplica.required` is configured, every rule below is fail-closed; deployment must provide a single-writer topology, a continuously available coordinator, and an owner for divergence resolution.

The replaceable `repository-replica-request.json` hint contains exactly `schemaVersion: 1` and a random `nonce`. It is owner-only generated runtime state, not source content or a canonical event. Atomic replacement retains at most one request; temporary files are removed after success or failure. Its bytes grant no authority, and the watcher need not interpret them.

A readiness wait subscribes before reading the receipt and publishing its request. Each new valid receipt triggers a fresh exact snapshot comparison. A mismatching unchanged receipt is not captured repeatedly. A 30-second recovery wake—or the legacy interval when receipt watching is unavailable—remains bounded by the original work timeout. Stale, invalid, missing, or divergent receipts never admit work.

On macOS, terminal completion inspects an installed owner-only repository-replica LaunchAgent. An unsafe, uninspectable, or unloaded installed service requires action before a repository-changing terminal turn completes. Absence means the repository did not install this optional external coordinator and makes no claim about replica availability.
