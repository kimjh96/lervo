# Readiness

Check service-manager stability and the owner-only health snapshot separately. Discord readiness appears as `conversation.status: ready` after Gateway READY or RESUMED authentication.

Startup history reconciliation runs as application work after that authenticated observation. A bounded history or platform failure is reported as `dispatch_failed`; it must not be relabeled as a Gateway protocol failure or force a reconnect loop. Live authenticated dispatch remains available. A later genuine reconnect retries reconciliation.
