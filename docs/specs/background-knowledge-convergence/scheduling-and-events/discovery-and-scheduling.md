# Discovery, state, and scheduling

## Discovery and durable continuation

One owner per repository shares the Node/CLI worker lock and exact outbox leases. Startup, local event changes and, under a Node resident, repository edits wake it; an adaptive timer that backs off from 60 seconds to 15 minutes behind a change fence inspects idle repositories ([resident cycle](../runtime/discovery-and-progress/resident-cycle.md)). Without a Node, a detached bounded CLI worker advances available stages but cannot promise progress after exit. Status exposes the absence of a resident host. No Hub is required.

Discovery captures a complete, stable source scan, lifecycle reasons, current canonical candidates, pending normalization families, and writer/delegation coordinates. A baseline identity binds project, source snapshot, policy, and debt digest. The baseline event and first queue row are atomic and idempotent. Lease expiry or host restart replays canonical events rather than creating another task system.

Preserve `repository.change.completed` as the canonical change-job source. Reconcile bounded pages against resolutions and outstanding entries so queue-capacity rejection cannot strand a discoverable event. Cursor advance and inserted projection rows share a transaction. Invalid or unsupported events stop at a visible reader boundary.

Stages are `assessment`, `canonical_review`, `canonical_integration`, `normalization_generation`, `normalization_review`, `normalization_apply`, and `lifecycle_verification`. Each acknowledgement atomically records its stage result and creates the next durable stage or dependency. `pending_review` counts as progress only with a readable exact candidate/decision and a scheduled owner. Existing `attention_required` outcomes may create a linked recovery obligation; their historical event is never updated or falsely marked current.

Startup migration inventories old resolutions, current candidates, and all current lifecycle debt. It records acknowledged but unfinished work, including null candidates, as fresh source-bound obligations. Irrecoverable historical before-bytes remain evidence gaps; a reviewed new baseline may establish present-state currency without retroactively proving the old change.

## State contract

Every local state binds obligation ID, source event/hash or baseline event/hash, source snapshot and debt digest, current stage, exact predecessor receipt, lease generation, agent assignment, delegation hash, attempt count, and next wakeup or dependency. Private candidate paths are resolved through hashes, not durable event bodies.

| State | Required additional proof | Meaning and recovery |
| --- | --- | --- |
| `queued` | Stage and available-at | Durable work exists; no completion claim. |
| `running` | Exact unexpired lease and assignment | One stage is executing; expiry requires inspection. |
| `waiting_review` | Non-null candidate hash, reviewer, queued successor | Automatic review remains scheduled. |
| `waiting_authority` | Exact decision/delegation dependency and owner | Authority is insufficient; resume only after a bound change. |
| `retry_scheduled` | Normalized failure, attempt, next-at | A transient failure has bounded backoff. |
| `stale` | Freshly observed mismatching source/context hash | Supersede against a new snapshot; never reuse approval. |
| `recovery_required` | Journal/target observation digest and owner | Effects are uncertain; no write retry before inspection. |
| `attention_required` | Bounded reason, owner, recovery condition | Exhausted or nontransient failure; visible, not discarded. |
| `current` | Exact stage receipts and verified currency digest | Bound scope completed; global completion also binds full baseline coverage. |
| `superseded` | Successor obligation ID/hash | New source replaced this scope without rewriting history. |

## Resource and fairness bounds

Initial activation uses finite reviewed ceilings: 1,024 outstanding obligations per repository, one active provider call per repository, and two background calls across the installed host. Live work has priority. A repository without a host arbiter cannot claim a fleet-wide ceiling; co-resident standalone CLI workers use the same host arbiter.

Each scheduling cycle advances at most eight stage jobs. A normalization batch selects at most eight documents, 1 MiB of source, and eight total provider calls, including fallback and regeneration. Preflight may select fewer documents; capacity is conservative, not a token prediction. Keep measured tokens, unavailable usage, and elapsed time separate from deterministic candidate identity. Token/spend ceilings come from the reviewed delegation; missing usage blocks the next admission when such a ceiling requires it.

Transient stages retry at most 16 times with exponential delay from one minute to one hour. Provider quota/authentication failures pause affected provider admission and expose a bounded reason instead of consuming repeated document attempts. Reset times come only from a normalized provider observation; an unknown reset requires refreshed evidence. Provider switching requires existing authority and newly bound output review.

Selection combines stage dependencies with oldest-ready work and a rotating cursor across source families. Rejected or oversized families remain visible without permanently blocking the leading batch. Source edits coalesce to a newer snapshot after a 30-second quiet period, with a 60-second maximum wait. Completion still requires finite stable input and available provider capacity; unlimited edits cannot be promised convergence.

A cycle makes no provider request when debt is zero, no stage is due, or authority/capacity is unavailable. Sleep until the next exact due time or event. Health reports host liveness, debt counts, oldest age, active stage, wait reason, and last verified currency separately. `ready` for transport never means knowledge current.
