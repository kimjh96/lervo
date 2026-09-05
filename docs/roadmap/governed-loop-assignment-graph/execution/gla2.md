# GLA2: Authority and cancellation transition

The provider-neutral approval-authority query/observation port is storage-neutral and requires exact assignment, requirement-digest, evidence-hash, and validity-interval bindings. Duplicate, foreign, malformed, or expired evidence fails closed. Approval matches the exact assignment requirement; digest-only approval sharing is insufficient.

The default CLI has no authority adapter: approval-gated assignments remain `await_approval`, and command-line text is not authority. GLA2 adds no approval issuer or model self-approval inference and does not make the controller effectful.

Cancellation uses a content-addressed, deterministic single-assignment plan bound to the current revision and status, with the distinct `assignment.cancelled` transition. Only queued or blocked work is cancellable. Leased work remains protected after expiry because expiry does not prove provider termination; GLA2 does not cancel leased provider work.

Requested and dependency-driven cancellation use exact plan/apply CLI composition. Dependency propagation is explicit and incremental, never a hidden multi-assignment transaction. The transition provides state/event rollback with the privacy-bounded `assignment.cancelled` event.
