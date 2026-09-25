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

## Every entry point (ADR-0433)

[ADR-0433](../../decisions/knowledge/repository/canonicalization/0433-own-background-knowledge-for-every-repository-change.md) extends this lifecycle from Discord conversations to managed `lervo run` executions and Claude Code or Codex terminal turns. When the repository writer is on event schema version 3, a changed managed run or terminal Stop now appends one `repository.change.completed` event and one `knowledge:repository` outbox job in the same transaction. The job carries a content-bound manifest with every changed path. Beyond 64 paths the event publishes only the count, and an unchanged unit records nothing. Writers below version 3 keep their previous behavior.

The core owner `processRepositoryKnowledgeJobs` claims these jobs and settles each one with `repository.knowledge.resolved` and its queue acknowledgement in one transaction:

- It rechecks the manifest and current bytes (`stale` on drift) and recovers exact former bytes from recent commits.
- A no-capability review classifies the change. Implementation-only work becomes `current` only when the read-only knowledge lifecycle check passes, which never applies a migration. A canonical candidate stays `pending_review`. Unavailable former bytes, lifecycle debt, or a `needs_review` verdict become `attention_required`.
- Transient failures back off, and the sixteenth attempt settles as exhausted.

`lervo knowledge worker --once --provider <claude|codex>` hosts the owner under a repository lock. A changed terminal Stop or managed run launches it detached from the verified hook runtime or CLI entry, so the turn never waits.

An installed Node with owner reasoning configured also hosts the owner in a bounded loop. The loop wakes on local event changes and at least every minute, using the configured absolute provider executable. It shares the CLI worker lock and per-job lease, so the two hosts never process the same job.

Still outstanding: supervised-run integration, the narrow write assignment for canonical candidates, conversation completions on the shared destination, and installed evidence.

## Reader-first foundation

The shared reader now accepts the bounded version-3 knowledge-outcome payload; no producer emits it. A local event-chain reconciler can reconstruct eligible historical `baseline_valid` work into a capacity-bound outbox, detect conflicting outcome coordinates, and recover idempotently after reopening SQLite. A source-coordinate manifest builder binds observed Git trees and dirty-path digests without source bodies. Its read-only job reader verifies the exact local CAS artifact against the completion; a currency inspector rechecks current after-path bytes, Git objects, and unsafe parent resolution before semantic review. Old dirty before-path bytes that cannot be reconstructed remain `needs_review`, never a success claim. The conversation completion writer has a dormant, explicitly selected version-3 path: it stores and rechecks that manifest before a changed-source `pending_background` completion, emits `not_applicable` for unchanged work, and omits global knowledge preflight/postflight only in that mode. Production composition still selects the existing synchronous path; the background agent, reviewed integration, reader activation, and installed latency evidence remain required before changing that selection.

Workforce state now has a separate deterministic knowledge-job assignment provenance bound to the exact completion, manifest reference, workstream, and durable agent. It rejects changed replay and claims by a different agent. This is a foundation for the leased worker, not evidence that one is active or that canonicalization has occurred.

The event store now supports an exact read-only outbox lookup. A dormant worker preflight uses it to fence an expired or reclaimed claim before and after CAS/Git source inspection, distinguishes legacy source absence from current source evidence, and makes no completion claim. The active background owner, review assignment/workspace, canonical integration, retry settlement, and installed evidence remain outstanding.

Knowledge-job assignments now record an explicit read-only access mode. Their source-path scopes do not acquire a write-path exclusion lease, while write-authority checks fail and legacy assignments still default to write. This removes a scheduler conflict with live writers but does not yet create the isolated read-only review workspace or execute a semantic review.

The leased review-source reader now captures exact committed before/after Git blobs and current dirty after-path bytes in memory under a combined 16 MiB limit. It rechecks source currency and the outbox lease after capture; drift, unavailable before bytes, unsupported kinds, and excess size cannot become a success claim. The bytes are not persisted or published.

The dormant reviewer now composes the read-only agent lease with the exact outbox lease and uses the existing Codex/Claude no-capability JSON runner. That runner creates a separate private temporary working directory and receives bounded source/context text through stdin without writing it to a Git workspace or CAS. The reviewer autonomously loads applicable `AGENTS.md` instructions and current repository-knowledge recommendations, verifying exact bytes before provider injection and rechecking authority and source currency after loading. Review output is validated as an in-memory candidate; source or instruction drift discards it.

A dormant non-success outcome writer now revalidates the source, separate background-agent assignment, and exact outbox lease, then atomically records `stale` or `attention_required` and acknowledges the queue row. It rejects contradictory source states, a changed lease, and an early retry-exhaustion claim. A recovery claim after the sixteenth attempt can settle exhaustion without another semantic work attempt. This is not the success producer: production still has no active background owner, target-specific write assignment, reviewed integration, `current` knowledge resolution, or installed latency acceptance.

If a content-bound source manifest is missing or hash-invalid, the non-success writer can now settle only the matching `knowledge_job_source_unavailable` or `knowledge_job_source_invalid` attention state, or a legitimately exhausted retry. It binds the assignment to the completion's recorded changed paths and manifest hash without claiming that unavailable bytes were reviewed. A valid manifest cannot be mislabeled as missing or invalid. This recovery path still does not activate the background owner or prove knowledge currency.

The same exact-lease outcome boundary now accepts historical version-2 `baseline_valid` debt with a separate read-only agent assignment whose manifest hash is null. It can record only `attention_required/legacy_source_unavailable` (or an exhausted retry) with the `legacy_unavailable` marker; it cannot invent source bytes, claim staleness, or claim knowledge currency. This makes irreconstructable historical debt inspectable without rewriting the old completion. It does not clear AXLI or Arca-next debt, activate a worker, or replace source-backed canonical review.
