# ADR-0429: Resume durable worker duty after owner restart

- Status: accepted
- Decision date: 2026-09-24

## Context

An installed owner with an older bound request deliberately defers its first post-start action until a new canonical source change. This prevents installation or restart from being interpreted as a fresh human request. On Kael, however, the previous process had already claimed a worker lease and confirmed workspace preparation. Restarting after a runtime correction found no unresolved decision and recorded the old source cursor. The owner resumed after the lease expired and changed the canonical source, but the startup deferral unnecessarily delayed the next decision while the durable assignment remained unfinished. Process health alone did not expose that delay.

## Decision

Keep a bounded, sixty-second startup grace period for a merely bound or queued goal. A canonical source change may end it earlier. The Node change loop schedules the cursor deadline even when the initial cycle has no report, so an unchanged goal is evaluated after the grace period. Bypass it when the canonical supervision snapshot contains an assignment without a terminal event that is leased or has a dispatch timestamp. That state is evidence of an already-started duty, not a new request. The normal projector, mandate, admission, readiness, lease, effect-inspection, and decision contracts still govern the next action. A confirmed effect is not repeated simply because a process restarted.

An unresolved recorded decision continues through its existing exact-effect reconciliation path before this startup rule. Terminal assignments, unleased and undispatched queued work, and unrelated old bound goals remain deferred until a canonical source change or the startup grace deadline. This evaluation uses only the exact bound request and current canonical sources; it does not infer missing historical conversation context. No new event or persistent cursor is introduced; the source snapshot and existing event chain remain authoritative.

## Consequences and verification

A restart can no longer strand a leased or dispatched duty behind a process-local cursor. An expired duty projects to ordinary recovery, while a live lease may continue only after current authority and readiness checks. Missing verification configuration remains `unobserved` and cannot be promoted by this rule. Orchestrator tests distinguish an old queued origin from leased and dispatched unfinished duties. Installed acceptance still requires observing Kael's post-restart decision, worker safe-start or non-start evidence, and result publication separately from process health.

The September 27 repair bounds the queued-goal deferral as well. Regression tests prove deadline wakeup without a source notification, one evaluation of an unchanged goal, and unchanged immediate continuation for leased or dispatched duties.

## References

- [Installed request intake](../../../../../specifications/execution/outcome-supervision/implementation/node-composition/installed-startup/request-intake.md)
- [Outcome supervision observations](../../../../../roadmap/product-outcome-convergence/execution/outcome-supervision/delivery/status/installed-observations.md)
