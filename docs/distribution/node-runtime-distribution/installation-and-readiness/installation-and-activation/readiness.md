# Readiness

Check service-manager stability separately from the owner-only health snapshot. Discord readiness appears as `conversation.status: ready` after Gateway READY or RESUMED authentication.

Startup history reconciliation runs as application work after that authenticated observation. Report a bounded history or platform failure as `dispatch_failed`; do not relabel it as a Gateway protocol failure or force a reconnect loop. Live authenticated dispatch remains available. A later genuine reconnect retries reconciliation.
