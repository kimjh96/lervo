# Asynchronous conversation knowledge lifecycle

State: `implementation required`.

## Outcome

Repository agents own source-bound canonicalization and knowledge convergence without adding global lifecycle work to a live conversation response. [ADR-0427](../../decisions/knowledge/repository/canonicalization/0427-decouple-conversation-work-from-agent-owned-knowledge-convergence.md) defines the evidence and authority boundary.

## Delivery and completion criteria

- [ ] Record an exact changed-path source-coordinate manifest in each eligible canonical conversation-work completion; rebuild one idempotent local job from bounded event pages after restart. Reject overflow rather than truncating path evidence.
- [ ] Remove global knowledge preflight and postflight from the live provider path while retaining result CAS, workstream, replica, and truthful pending-state checks.
- [ ] Run a bounded, restart-safe, provider-neutral background owner in an isolated assignment/workspace, without sharing the live turn's writer or provider session.
- [ ] Have that agent assess durable outcomes, make authorized canonical edits through reviewed integration, or create an exact review candidate when user-owned content blocks automatic change. A structural refresh alone is not a semantic completion.
- [ ] Run ordered migration, refresh, and lint after canonical review; record a distinct current or non-success knowledge outcome with no raw content in events.
- [ ] Convert historical `baseline_valid` into explicit, inspectable debt without altering old completion events; clear existing AXLI and Arca-next debt with source-backed outcomes.
- [ ] Bound queue capacity, retries, retention, provider resources, and attention escalation. Prove lost-response and restart idempotency.
- [ ] Measure live response latency while the worker is busy; verify installed Discord result and subsequent knowledge convergence independently, including no-Hub operation and user-owned conflict safety.

Until every criterion and installed evidence pass, `pending_background` must not be enabled on an installed Node and existing synchronous completion remains the runtime behavior.

## Reader-first foundation

The shared reader now accepts the bounded version-3 knowledge-outcome payload; no producer emits it. A local event-chain reconciler can reconstruct eligible historical `baseline_valid` work into a capacity-bound outbox, detect conflicting outcome coordinates, and recover idempotently after reopening SQLite. A source-coordinate manifest builder binds observed Git trees and dirty-path digests without source bodies. Its read-only job reader verifies the exact local CAS artifact against the completion; a currency inspector rechecks current after-path bytes, Git objects, and unsafe parent resolution before semantic review. Old dirty before-path bytes that cannot be reconstructed remain `needs_review`, never a success claim. The conversation completion writer has a dormant, explicitly selected version-3 path: it stores and rechecks that manifest before a changed-source `pending_background` completion, emits `not_applicable` for unchanged work, and omits global knowledge preflight/postflight only in that mode. Production composition still selects the existing synchronous path; the background agent, reviewed integration, reader activation, and installed latency evidence remain required before changing that selection.

Workforce state now has a separate deterministic knowledge-job assignment provenance bound to the exact completion, manifest reference, workstream, and durable agent. It rejects changed replay and claims by a different agent. This is a foundation for the leased worker, not evidence that one is active or that canonicalization has occurred.

The event store now supports an exact read-only outbox lookup. A dormant worker preflight uses it to fence an expired or reclaimed claim before and after CAS/Git source inspection, distinguishes legacy source absence from current source evidence, and makes no completion claim. The active background owner, review assignment/workspace, canonical integration, retry settlement, and installed evidence remain outstanding.

Knowledge-job assignments now record an explicit read-only access mode. Their source-path scopes do not acquire a write-path exclusion lease, while write-authority checks fail and legacy assignments still default to write. This removes a scheduler conflict with live writers but does not yet create the isolated read-only review workspace or execute a semantic review.

The leased review-source reader now captures exact committed before/after Git blobs and current dirty after-path bytes in memory under a combined 16 MiB limit. It rechecks source currency and the outbox lease after capture; drift, unavailable before bytes, unsupported kinds, and excess size cannot become a success claim. The bytes are not persisted or published. This is review input only: isolated workspace provisioning, provider-neutral semantic review, target-specific write assignment, integration, knowledge settlement, and installed latency acceptance remain outstanding.
