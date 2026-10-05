# ADR-0465: Commit settled knowledge documents at batch boundaries

Status: `accepted`
Decision date: 2026-10-05
Amends: [ADR-0450](../repository/canonicalization/0450-keep-background-knowledge-out-of-developer-flow.md) and [ADR-0444](../repository/canonicalization/0444-serialize-knowledge-materialization-with-managed-runs.md)

## Context

On the installed Mac, the last `Lervo Knowledge` output commit landed on 2026-10-04 at 03:49 UTC. In the following 25 hours, 26 obligations were superseded with `source_bytes_changed`, and none reached `lifecycle_verification`. The working tree accumulated 37 reviewed outputs: normalization rewrites and records from a `normalization_apply` at 00:31 UTC, plus integrated canonical drafts. Four causes combined:

- **Commit at the last stage.** ADR-0450 commits settled outputs only at the start of `lifecycle_verification`. That stage runs after the whole normalization backlog of 92 to 112 documents drains under one unchanged snapshot. With roughly 60 developer commits a day, that never happened.
- **Repeated review timeouts.** Generation took an eight-document batch of large ADRs (91 KB of source). Its independent review exceeded the 300-second runner timeout 12 times across five `normalization_review` deliveries between 00:45 and 04:54 UTC. Each retry reviewed the same batch, so the timeout repeated until a commit staled the obligation.
- **Concurrent edits treated as unsafe.** The scanner raised `knowledge_source_unsafe` when a file or `HEAD` changed during a scan. A commit during canonical integration at 03:47 UTC therefore recorded `attention_required` instead of `stale`. The same race aborted 17 resident cycles in discovery, before any stage ran, and was first recorded on 2026-10-01 ([linked-authority correction](../../../evidence/quality/background-knowledge-convergence-implementation/installed-2026-10-01/knowledge-worker/linked-authority-correction.md)). [ADR-0436](../repository/canonicalization/0436-reviewed-source-capture-and-bounded-canonical-worksets.md) already defines `source_bytes_changed` for changes during observation. The worker log printed only the code, so the cause was not visible.
- **Live transactions treated as interrupted.** A terminal compile or managed run with an open materialization journal made the worker report `recovery_required`, although the owning process was still running.

## Decision

- **Batch-boundary commits.** At the start of `assessment` and `normalization_generation`, the worker commits settled reviewed outputs exactly as ADR-0450 selects them. Each canonical integration and each normalization apply is followed by one of these stages, so outputs are committed one stage after they settle. The commit-only result re-queues the same stage with ADR-0450's HEAD fence (`committedHead`), so the obligation continues on the post-commit snapshot and is not superseded. `lifecycle_verification` keeps its own commit. Mid-batch stages (`canonical_review`, `canonical_integration`, `normalization_review`, `normalization_apply`) never commit, because their stage events carry review and integration evidence that a commit-only receipt must not impersonate. Before running the normalization inspection, selection checks that a dirty normalization record or a present integrated draft exists.
- **Smaller batch after a review timeout.** If the independent normalization review times out on a batch of two or more documents, the review stage completes with proof `review_timed_out`. It returns to `normalization_generation` with `normalizationDocumentLimit` halved, down to one document. The limit lasts for the obligation. A timeout on a single document keeps the existing transient retry.
- **Concurrent change is staleness.** When a source changes size, identity, or modification time, disappears, or `HEAD` moves during a scan, the scanner raises `source_bytes_changed` with the repository-relative path. Baseline discovery retries a capture invalidated this way up to three times before failing the cycle. The Node conversation classifier treats `source_bytes_changed` as retryable unavailable context.
- **Live owners are busy.** The worker inspects the journal owner. If another running process owns it, the cycle returns `busy`, and a stage records `knowledge_materialization_busy` (`retry_scheduled`). An interrupted journal keeps ADR-0444's explicit recovery: the worker never rolls bytes back on its own. Its `recovery_required` status now names `recoveryCommand: "lervo knowledge materialize --recover"`.
- **Failure detail.** A failed resident cycle writes one line with the stable code. A typed Lervo failure adds its message, at most 300 characters, on one line, with the repository root shortened to `.`. Native and provider errors stay code-only.

## Failure and privacy

The scanner now uses the existing `source_bytes_changed` meaning, which is "source bytes changed since capture; recapture and supersede". This decision adds no event type. `review_timed_out` is private stage proof. `normalizationDocumentLimit` is private stage data. `recoveryCommand` is an optional status field that names a fixed CLI command and carries no repository data. The worker log is an owner-only local diagnostic. It may contain repository-relative paths from typed Lervo failures, never source bodies, prompts, or native error text.

## Verification

Focused tests must show:

- An integrated draft is committed at the next batch-boundary stage, with no `lifecycle_verification` event and no supersession.
- After a timed-out two-document review, single-document batches converge without a transient retry of the same batch.
- A `HEAD` change during a scan reports `source_bytes_changed`, and discovery retries at most three times.
- A journal owned by a live process yields `busy`, and an interrupted journal reports the recovery command.
- The worker log line carries typed detail and keeps native errors code-only.

Installed verification must show an output commit within one batch after a normalization apply or canonical integration, while the developer keeps committing.
