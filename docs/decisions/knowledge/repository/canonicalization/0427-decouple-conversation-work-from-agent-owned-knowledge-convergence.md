# ADR-0427: Decouple conversation work from agent-owned knowledge convergence

Status: accepted
Decision date: 2026-09-23
Amended by: [ADR-0433](0433-own-background-knowledge-for-every-repository-change.md), [ADR-0452](../../../foundation/0452-open-collaboration-by-default-with-authority-at-consequential-effects.md), [ADR-0457](../../documents/0457-degrade-knowledge-intake-per-file-and-consolidate-documents.md)

## Context

Native conversation repository work checks global managed-knowledge currency before provider execution and result publication. The post-turn check permits `baseline_valid` for unrelated pre-turn debt. A slow or stale global projection therefore delays conversations, while `baseline_valid` can persist without an owner or due reconciliation. A one-time operator refresh does not satisfy autonomous canonicalization and maintenance.

Provider results, repository checkpoints, canonical-source assessments, structural projections, and visible replies are distinct outcomes. A shared synchronous completion gate delays replies and hides old debt; removing it without a durable owner would further obscure that debt.

## Decision

### Separate truthful outcomes

Before publication, the live turn retains admission, repository observation, result CAS, an exact workstream checkpoint, configured replica readiness, and one canonical repository-work completion. It does not run global knowledge assertion, migration, normalization, or refresh before provider execution or publication of its verified result.

Changed-source completions record `pending_background`, never `current` or `baseline_valid`; their visible results must not claim convergence while pending. Unchanged turns record `not_applicable` without a new source-bound knowledge job. This means only that the turn changed no repository source; pre-existing debt remains in the separately owned baseline queue and global currency is not asserted.

The completion event is the durable job source. A background reconciler reads bounded canonical-chain pages and idempotently enqueues eligible completions into a local knowledge-job outbox under ADR-0194's destination-reconciliation boundary. There is no second live-path queue write, so no completion can be lost between append and enqueue. Failed completion append leaves native work effect-uncertain and prevents a success reply. Exact source-event identity and result hash deduplicate replay, which neither reexecutes provider work nor creates another job. The local event chain is canonical and requires no Hub; outbox, cursor, and search projections are rebuildable from canonical events.

### Source-bound agent work

Each job binds the completion event, source conversation event, durable agent, provider-neutral role and assignment, before/after repository revisions, exact changed-path source-coordinate manifest, workstream snapshot, and result digest. Coordinates are a Git tree and relative path, an observed dirty-path digest, or an observed deletion; the worker rechecks them before claiming content currency.

Changed bound after-path bytes mean `stale`. Unreconstructable pre-turn dirty bytes mean `needs_review`, never `current`: a digest alone cannot establish semantic change. The manifest is bounded, local, and content-addressed, excluding request text, provider output, source bytes, and credentials. Excess path count is a typed failure, never silently truncated success. Preexisting `baseline_valid` completions become explicit migration debt without rewriting historical events or inventing original manifests.

The background owner leases one job, reads applicable canonical instructions, and reviews the exact change through a separate agent assignment in an isolated workspace. It classifies whether a durable fact or behavioral obligation needs a canonical target; implementation-only outcomes require a source-bound rationale. Canonicalization follows the existing typed responsibility and candidate lifecycle. Authorized canonical-source writes use the ordinary scoped repository-change and integration contract. User-owned conflicts become exact review candidates and are never silently overwritten. Projection refresh alone cannot close an unreviewed canonicalization obligation.

Read-only semantic review uses the existing provider-neutral no-capability process boundary: Codex and Claude run in a fresh private temporary directory with model tools and session persistence disabled. Exact source bytes enter through stdin only. This is not an ordinary writable Git worktree. A separate narrow write assignment uses the normal workspace and integration lifecycle only after identifying a canonical target.

The first knowledge-job assignment is explicitly read-only. Expected paths bound source access without an exclusive write-path lease, allowing live writers to proceed. It cannot authorize managed repository writes or activate an ordinary writer workspace. Proposed canonical edits require a separate narrow write assignment and normal workspace/integration contract. Legacy assignments without an access-mode field retain write-lease semantics; absence never implies read-only. Before background activation, the review workspace must be isolated and non-writable.

The no-capability reviewer adds no fake writer state to the durable Git-workspace lifecycle. Its temporary directory contains no repository source bytes, and its provider invocation has no filesystem tool capability.

Before integration, recheck source hashes, assignment lease, canonical-target ownership, and current target revision. Stale evidence explicitly reopens or supersedes the item; repetition or provider agreement cannot make it current. After reviewed source integration, migration, refresh, and lint establish the knowledge result. Live conversations do not wait. A separate status or follow-up may report completion only after obtaining its own delivery receipt.

### Recovery, capacity, and failure meaning

Lease and retry transient failures with bounded backoff and an attempt ceiling. Restart reclaims expired leases and resumes from the last canonical outcome, inspecting uncertain repository effects before retry. Exact completed jobs are idempotent. Observed source drift becomes `stale`; permanent authority conflicts, source limits, and exhausted attempts become visible `attention_required` with an owner and reason, never perpetual pending.

Queue reconciliation has an explicit capacity bound. A full local queue stops projection, keeps the canonical completion discoverable, and reports backpressure without marking the job processed. A cheap admission check prevents unlimited pending work without global knowledge compilation. Purge acknowledged entries under bounded retention only after their canonical outcomes remain inspectable.

Outcome append and queue acknowledgement share one exact-lease event-store transaction. After checking the separate background-agent assignment, a non-success writer may record `stale` only for observed source drift or `attention_required` for bounded failure. A recovery claim after the sixteenth work attempt may record `knowledge_retry_exhausted` without a seventeenth semantic attempt: the bounded event count remains 16 even if operational lease count is higher. Expired leases and append failures must not consume jobs without durable resolution. The later verified `current` producer must use the same atomic boundary.

The new event is `conversation.repository_knowledge.resolved`. Required fields are completion event ID/hash, source event ID, job ID, agent ID, source-manifest hash or legacy-unavailable marker, terminal state (`current`, `pending_review`, `stale`, or `attention_required`), attempt count, bounded failure code or null, knowledge snapshot hash when current, and occurred-at time. Exclude message bodies, provider output, source bytes, local absolute paths, credentials, and raw failure text.

`current` means source-bound canonicalization and the knowledge lifecycle passed for the bound source. `pending_review` is not success; `stale` requires fresh source evidence; `attention_required` identifies a bounded nonretryable or exhausted failure. Retry and lease state never claim currency.

Read-only source preflight returns `ready_for_review`, `stale`, or `needs_review`; none claims knowledge success. `ready_for_review` requires the content-bound artifact to match the completion, current after-path bytes to match Git-tree or working-tree coordinates, and reconstructable before-path evidence. Changed after-paths yield `stale`. Unavailable pre-turn dirty bytes, unsafe parent resolution, or unavailable Git/object observations yield `needs_review`.

Preflight reasons are bounded to `source_bytes_changed`, `before_bytes_unavailable`, `unsafe_path_resolution`, and `source_evidence_unavailable`, excluding paths and source bodies. Missing manifests yield `knowledge_job_source_unavailable`; malformed, over-bound, or mismatched artifacts yield `knowledge_job_source_invalid`. Retry or refresh alone cannot promote either failure to `current`.

Before semantic review, exact leased source capture reads pinned Git blobs and current dirty after-path bytes into process memory with a combined 16 MiB ceiling. After capture, verify the dirty digest and source currency again, then recheck the exact outbox lease. Captured bytes are private inputs, never event fields, CAS artifacts, or workspace files. Changed source remains `stale`; unsupported kinds yield `needs_review` with `review_source_kind_unsupported`; exceeding the ceiling raises bounded `review_source_limit_exceeded`. None claims semantic review or currency. Verify the review assignment and physically isolated read-only workspace before disclosing bytes to a provider.

No-capability semantic review accepts only exact UTF-8 source and content-hash-matched canonical context, with a separate 256 KiB provider-input ceiling and no truncation. Reject binary text as `review_source_encoding_unsupported`, invalid context as `review_context_invalid`, an untrusted provider boundary as `review_provider_boundary_invalid`, malformed model output as `review_provider_response_invalid`, and missing usage as `review_usage_unavailable`.

Canonical instructions changing before or during the call yield private `needs_review/review_context_stale`; changed source remains `stale`. Recheck outbox and agent-assignment leases around the call. Bounded results (`implementation_only`, `canonical_change_candidate`, or `needs_review`) are private candidates, never canonical events, write authorization, human approval, or knowledge-current outcomes. Omit source and context text from public status and telemetry; later durable resolution carries only the specified bounded coordinates.

The context loader discovers and loads the applicable `AGENTS.md` hierarchy as required instruction evidence. It obtains bounded canonical-document recommendations from the product's default repository ranker, prioritizes recommendations sharing source-path terms within that set, then reads exact repository bytes and verifies each recommendation hash. Path affinity selects context without granting authority. A stale concept sidecar alone does not invalidate current canonical Markdown; the byte check determines exactness.

Recommendation is not loading, injection, or use. Only read-and-hashed documents are loaded; the provider call is the separate injection boundary. Retrieval is bounded, not exhaustive: return `needs_review` when missing context prevents reliable classification. Missing or unreadable required instructions or selected documents yield private `needs_review/review_context_unavailable`; more applicable instructions than the eight-document input bound yield `needs_review/review_context_limit_exceeded`; changed selected recommendation bytes yield `needs_review/review_context_stale`. These codes exclude source bodies, query text, paths, and credentials and never imply currency. After context loading, recheck both leases and source currency before disclosing source bytes.

Historical `current` and `baseline_valid` retain their meaning for readers. New changed-source writers use `pending_background` with a required content-bound manifest; unchanged-source writers use `not_applicable` with zero changed paths and no manifest. Neither claims currency. Migration opens explicit debt for old `baseline_valid` events without retroactive upgrades. Readers reject unknown writer versions until compatible. Repository-work `verificationStatus: passed` proves only the native work/result/checkpoint/replica boundary, not background knowledge completion.

## Consequences and acceptance

This changes ADR-0395's synchronous guarantee and installed Discord scope; both documents must identify the new boundary when the writer activates. The async worker must not share a writable checkout or provider session with a live turn. Bound its CPU/provider concurrency and queue depth independently of live ingress.

Acceptance requires a real installed conversation journey and common provider-adapter contract tests. Prove prompt changed-source publication while knowledge is pending, followed by worker writing or reviewing the right canonical target, refresh, lint, and exactly one current outcome.

Also prove no lost job between completion and enqueue, restart/idempotency, retry exhaustion, stale source, user-owned conflict, legacy `baseline_valid` migration, path/privacy bounds, queue backpressure, no-Hub operation, and measured live-path latency with the worker busy. A healthy Node, queued event, or one-time manual refresh alone proves none of these.

## References

- [ADR-0303](0303-branch-safe-knowledge-reconciliation-and-canonicalization.md)
- [ADR-0194](../../../coordination/sync/0194-destination-bound-local-event-reconciliation.md)
- [ADR-0395](../../../coordination/conversations/0395-resumable-native-repository-work-turns.md)
- [Agent workspaces](../../../../specifications/execution/agent-workspaces.md)
- [Canonicalization assessment](../../../../specs/repository-knowledge-lifecycle-convergence/canonicalization-assessment.md)
- [Async knowledge roadmap](../../../../roadmap/knowledge/asynchronous-conversation-lifecycle.md)
