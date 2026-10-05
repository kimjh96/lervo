# ADR-0465: Commit settled knowledge documents at batch boundaries

Status: `accepted`
Decision date: 2026-10-05
Amends: [ADR-0450](../repository/canonicalization/0450-keep-background-knowledge-out-of-developer-flow.md) and [ADR-0444](../repository/canonicalization/0444-serialize-knowledge-materialization-with-managed-runs.md)

## Context

On the installed Mac, the last `Lervo Knowledge` output commit landed at 03:49 UTC on 2026-10-04. Over the next 25 hours, 26 obligations were superseded with `source_bytes_changed`; none reached `lifecycle_verification`. The working tree accumulated 37 reviewed outputs: normalization rewrites and records from a `normalization_apply` at 00:31 UTC, plus integrated canonical drafts. Four causes combined:

- **Late commits.** ADR-0450 commits settled outputs only at the start of `lifecycle_verification`, after the entire normalization backlog of 92–112 documents drains under one unchanged snapshot. Roughly 60 developer commits a day prevented this.
- **Repeated review timeouts.** Generation selected eight large ADRs totaling 91 KB of source. Independent review exceeded the 300-second runner timeout 12 times across five `normalization_review` deliveries between 00:45 and 04:54 UTC. Retries reviewed the same batch until a commit staled the obligation.
- **Concurrent edits classified as unsafe.** The scanner raised `knowledge_source_unsafe` when a file or `HEAD` changed during a scan. A commit during canonical integration at 03:47 UTC therefore recorded `attention_required` instead of `stale`. The same race aborted 17 resident cycles during discovery, before any stage ran, and was first recorded on 2026-10-01 ([linked-authority correction](../../../evidence/quality/background-knowledge-convergence-implementation/installed-2026-10-01/knowledge-worker/linked-authority-correction.md)). [ADR-0436](../repository/canonicalization/0436-reviewed-source-capture-and-bounded-canonical-worksets.md) already defines `source_bytes_changed` for changes during observation. Code-only worker logs hid the cause.
- **Live transactions classified as interrupted.** A terminal compile or managed run with an open materialization journal triggered `recovery_required` even while its owning process was running.

## Decision

### Commit at batch boundaries

At the start of `assessment` and `normalization_generation`, the worker commits settled reviewed outputs using ADR-0450's selection rules. Each canonical integration and normalization apply is followed by one of these stages, so outputs commit one stage after settling.

The commit-only result re-queues the same stage with ADR-0450's HEAD fence (`committedHead`). The obligation continues on the post-commit snapshot without supersession. `lifecycle_verification` retains its own commit.

Mid-batch stages (`canonical_review`, `canonical_integration`, `normalization_review`, `normalization_apply`) never commit: their stage events carry review and integration evidence that a commit-only receipt must not impersonate. Before running normalization inspection, selection checks for a dirty normalization record or a present integrated draft.

### Reduce batches after review timeouts

If independent normalization review times out on two or more documents, the review stage completes with proof `review_timed_out` and returns to `normalization_generation` with `normalizationDocumentLimit` halved, down to one document. The limit lasts for the obligation. A single-document timeout retains the existing transient retry.

### Treat concurrent changes as staleness

If a source changes size, identity, or modification time, disappears, or `HEAD` moves during a scan, the scanner raises `source_bytes_changed` with the repository-relative path. Baseline discovery retries a capture invalidated this way up to three times before failing the cycle. The Node conversation classifier treats `source_bytes_changed` as retryable unavailable context.

### Treat live journal owners as busy

The worker inspects the journal owner. If another running process owns the journal, the cycle returns `busy`, and a stage records `knowledge_materialization_busy` (`retry_scheduled`).

An interrupted journal retains ADR-0444's explicit recovery: the worker never rolls bytes back on its own. Its `recovery_required` status includes `recoveryCommand: "lervo knowledge materialize --recover"`.

### Include bounded failure detail

A failed resident cycle logs one line containing the stable code. Typed Lervo failures add their message, limited to 300 characters on one line, with the repository root shortened to `.`. Native and provider errors remain code-only.

## Failure and privacy

The scanner uses the existing `source_bytes_changed` meaning: "source bytes changed since capture; recapture and supersede". This decision adds no event type.

- `review_timed_out` is private stage proof.
- `normalizationDocumentLimit` is private stage data.
- `recoveryCommand` is an optional status field naming a fixed CLI command; it carries no repository data.
- The worker log is an owner-only local diagnostic. It may contain repository-relative paths from typed Lervo failures, never source bodies, prompts, or native error text.

## Verification

Focused tests must show:

- An integrated draft commits at the next batch-boundary stage, without a `lifecycle_verification` event or supersession.
- After a timed-out two-document review, single-document batches converge without a transient retry of the same batch.
- A `HEAD` change during a scan reports `source_bytes_changed`, and discovery retries at most three times.
- A live process's journal yields `busy`; an interrupted journal reports the recovery command.
- Worker log lines include typed detail and keep native errors code-only.

Installed verification must show an output commit within one batch after a normalization apply or canonical integration while the developer keeps committing.
