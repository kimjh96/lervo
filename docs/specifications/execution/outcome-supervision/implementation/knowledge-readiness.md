# Supervision knowledge readiness

## Observation boundary

Every Node dispatch, retry, and owner-execution preflight independently inspects the control repository's configured knowledge sources, document normalization, and knowledge lint. A second inspection runs before final admission. Repository currency does not prove worker-workspace selection, loading, injection, use, or delivery; positive task-specific application evidence remains required.

The Node adapter reuses repository-knowledge's read-only scanner, normalization inspector, lint, and materialization-transaction guard. It runs no compiler provider, migration, document rewrite, plan creation, or persistent cache. Existing scanner policy bounds remain authoritative. Foreground inspection is neither a production polling loop nor a constant-time readiness guarantee.

Native dispatch completes the full knowledge inspection before loading task context and observing permissions, authentication, executables, workspace, ancestry, and leases. A separate sixty-second validity window starts with the first knowledge scan and covers preparation and subsequent admission. This permits complete repository validation; an installed WSL observation of 3,977 sources and 59,000 units took about 23 seconds. The window does not extend the five-second bounds for runtime probes, permissions, leases, loaded context, or final admission.

Context retrieval precedes its observation timestamp. The loader then:

1. Reads and hashes the selected source bytes.
2. Verifies recommendation hashes.
3. Rechecks the current workstream within five seconds.

Canonical readiness begins with these reads, not the earlier search request. Supplied application readiness retains its original timestamp. Every execution preflight creates a new knowledge inspection; inspections are never reused across cycles or effects.

Each dispatch preflight opens one read-only event and artifact store before loading task context. Retained-workspace checks share that connection throughout the preflight, which closes it on success or failure. This avoids repeating the event-store integrity audit for every historical workspace and current-workspace recheck.

Every proof rereads its canonical artifacts, decision and absence evidence, current workspace record, and native checkout; proof results are not cached. Retained predecessor workspaces are checked in batches of at most four independent reads. Every started read settles before the batch returns or rejects, and no later batch starts after a failure. Every predecessor must pass before a current workspace is returned. Source order, complete coverage, per-proof event-head checks, and five-second limits remain unchanged. This adds no cache, persistent state, event authority, or execution authority. The shared reader must match the exact repository and project. Individual proofs never close caller-owned readers.

Responsibility claim admission and its effect adapter pass their existing verified store to every retained-workspace proof, preserving complete artifact and live-checkout rechecks without reopening the entire store for each predecessor. Canonical owner-reasoning facts likewise supply their existing verified store to retained-workspace proofs during planning and repeated admission. Native dispatch planning, canonical workspace preparation, ready-workspace receipt recovery, and worker-process admission also pass their verified store through each workspace proof. Sharing the connection grants no authority or cached proof. All five-second readiness, lease, and final-admission checks remain unchanged.

After canonical task context is bound, final runtime and repository probes run concurrently with the independent admission and authority reread. Both operations must settle before the shared reader closes or any effect begins, including when either fails. Execution then rechecks the current mandate and applies the unchanged five-second admission and readiness bounds. This overlap creates no cached observation or additional authority.

Repository coordination resolves the Git worktree root and common directory in one fresh Git invocation. Exact project-root comparison, common-directory inspection, private marker validation, and worktree-shared authority remain mandatory. Partial, ambiguous, multiline, or malformed coordinates fail closed. The single invocation removes duplicate process startup without caching repository identity.

Assignment listings resolve repository coordination once per call and validate every record and current role against that freshly observed collection. They retain neither coordinates nor assignment values across calls.

## Evidence and failures

A positive application knowledge check is supplemented only when both scans:

- Belong to the plan's project.
- Completely cover the configured source set.
- Agree on source snapshot and policy hashes.

For a scoped dispatch, normalization must have no pending document within the plan's expected paths. Lint must be valid with no errors. Warnings about unrelated document normalization or rebuildable structural materialization do not invalidate exact source bytes, but remain visible in knowledge lint. An unscoped observer keeps the stricter zero-pending, zero-issue requirement. Loaded context, required path hashes and later task-specific evidence remain independent checks.

The dispatch and final effect preflight must observe the same complete repository source snapshot. Any source change between them blocks the effect, including a change outside the task's expected paths. A fresh cycle re-observes the repository and does not reuse the prior snapshot.

Any of these conditions changes a positive knowledge check to `unobserved` with a null evidence hash:

- An open materialization transaction.
- Incomplete coverage.
- Changed source or policy.
- Project mismatch.
- Pending normalization within a required path, or any pending normalization for an unscoped observation.
- A lint error, or any lint issue for an unscoped observation.
- An inspection exception.
- Inspection or subsequent use outside zero to sixty seconds from the first scan.

Failed, unobserved, not-required, missing, and missing-hash application checks are never promoted. Preserve the original readiness observation time; a fresh repository inspection cannot refresh stale task-context evidence.

Combined evidence hashes bind the prior application evidence, project identity, source snapshot, policy, normalization report, lint result, and knowledge observation and expiration times. Combined readiness cannot expire after the knowledge inspection. Readiness exposes no raw repository paths, source bodies, document names, or unrestricted errors. Existing knowledge transaction and readiness contracts define failure meaning; this adapter adds no event fields, persistent state, or authority.

Scans and lint are bounded observations, not an atomic filesystem transaction. The effect adapter retains final task-context and permission checks at commit. A healthy control repository does not prove an up-to-date worker checkout, correct required skills, factual source quality, or research-source-policy compliance.

## Verification and remaining work

Use disposable repositories and real knowledge migrations to test:

- Current materialization.
- Absent or stale projections.
- Pending document normalization.
- Negative application evidence.
- Source changes between execution preflights.

The observer must cause no production repository migration or supervision activation.

Authentication, actual task-tool permissions, research source policy, verification execution, budget observations, and process observations remain separate integration work. Before duty bindings authorize execution, production responsibility installation must also reconcile claim-induced assignment revisions and live leases.
