# Readiness

Check service-manager stability separately from the owner-only health snapshot. Discord readiness appears as `conversation.status: ready` after Gateway READY or RESUMED authentication.

Startup history reconciliation runs as application work after that authenticated observation. Report a bounded history or platform failure as `dispatch_failed`; do not relabel it as a Gateway protocol failure or force a reconnect loop. Live authenticated dispatch remains available. A later genuine reconnect retries reconciliation.

Fleet readiness also requires the installed external SDK dependency graph to match its content-addressed runtime. Missing files plan `node_runtime_dependencies_missing`; different bytes or redirected links report `node_runtime_dependency_conflict`. Service and Gateway health cannot substitute for this check.

Startup and `--check-config` import the SDK before services open. `runtime_dependency_unavailable` means SDK installation material could not be loaded; it makes no claim about login or provider availability. This import preflight starts no provider and sends no network request. See [ADR-0492](../../../../decisions/operations/services/0492-install-and-verify-node-runtime-dependency-closures.md).
