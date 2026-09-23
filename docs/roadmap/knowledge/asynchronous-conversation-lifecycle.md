# Asynchronous conversation knowledge lifecycle

State: `implementation required`.

## Outcome

Repository agents own source-bound canonicalization and knowledge convergence without adding global lifecycle work to a live conversation response. [ADR-0427](../../decisions/knowledge/repository/canonicalization/0427-decouple-conversation-work-from-agent-owned-knowledge-convergence.md) defines the evidence and authority boundary.

## Delivery and completion criteria

- [ ] Record an exact changed-path hash manifest and atomically enqueue one local knowledge job with each eligible canonical conversation-work completion. Reject overflow rather than truncating path evidence.
- [ ] Remove global knowledge preflight and postflight from the live provider path while retaining result CAS, workstream, replica, and truthful pending-state checks.
- [ ] Run a bounded, restart-safe, provider-neutral background owner in an isolated assignment/workspace, without sharing the live turn's writer or provider session.
- [ ] Have that agent assess durable outcomes, make authorized canonical edits through reviewed integration, or create an exact review candidate when user-owned content blocks automatic change. A structural refresh alone is not a semantic completion.
- [ ] Run ordered migration, refresh, and lint after canonical review; record a distinct current or non-success knowledge outcome with no raw content in events.
- [ ] Convert historical `baseline_valid` into explicit, inspectable debt without altering old completion events; clear existing AXLI and Arca-next debt with source-backed outcomes.
- [ ] Bound queue capacity, retries, retention, provider resources, and attention escalation. Prove lost-response and restart idempotency.
- [ ] Measure live response latency while the worker is busy; verify installed Discord result and subsequent knowledge convergence independently, including no-Hub operation and user-owned conflict safety.

Until every criterion and installed evidence pass, `pending_background` must not be enabled on an installed Node and existing synchronous completion remains the runtime behavior.
