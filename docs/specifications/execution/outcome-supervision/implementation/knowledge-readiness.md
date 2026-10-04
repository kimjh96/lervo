# Supervision knowledge readiness

## Observation boundary

Every Node dispatch, retry, and owner-execution preflight independently inspects the control repository's configured knowledge sources, document normalization, and knowledge lint. A second inspection precedes final admission. Repository currency does not prove worker-workspace selection, loading, injection, use, or delivery; positive task-specific application evidence remains required.

The Node adapter reuses repository-knowledge's read-only scanner, normalization inspector, lint, and materialization-transaction guard. It runs no compiler provider, migration, document rewrite, plan creation, or persistent cache. Existing scanner policy bounds remain authoritative. Foreground inspection is neither a production polling loop nor a constant-time readiness guarantee.

Native dispatch completes knowledge inspection before preparing assignment, workspace, role, and policy evidence. Final native preflight settles repeated task admission and independent source/authority admission before loading and dating the exact task context. Changed task admission facts reject preflight; neither admission result is silently discarded on failure. Initial planning readiness instead confirms task admission after context loading. Both paths recheck role and policy after loading. Context observation time never advances without those source reads.

A separate sixty-second validity window starts with the first knowledge scan and covers preparation and subsequent admission. This permits complete repository validation: an installed WSL observation of 3,977 sources and 59,000 units took about 23 seconds. It does not extend the five-second bounds for runtime probes, permissions, leases, loaded context, or final admission.

Context retrieval precedes its observation timestamp. The loader then:

1. Reads and hashes selected source bytes.
2. Verifies recommendation hashes.
3. Rechecks the current workstream within five seconds.

Canonical readiness begins with these reads, not the earlier search request. Supplied application readiness retains its original timestamp. Every execution preflight creates a new knowledge inspection; inspections are never reused across cycles or effects.

### Shared readers and workspace proofs

Each dispatch preflight opens one read-only event and artifact store before loading task context. Retained-workspace checks share that connection throughout preflight; it closes on success or failure. This avoids repeating the event-store integrity audit for every historical workspace and current-workspace recheck.

Every proof rereads its canonical artifacts, decision and absence evidence, current workspace record, and native checkout. Proof results are never cached. Retained predecessor workspaces are checked in batches of at most four independent reads. Every started read settles before its batch returns or rejects; no later batch starts after failure. Every predecessor must pass before a current workspace is returned. Source order, complete coverage, per-proof event-head checks, and five-second limits remain unchanged. Sharing adds no cache, persistent state, event authority, or execution authority. The shared reader must match the exact repository and project; individual proofs never close caller-owned readers.

The following callers pass their existing verified store to every retained-workspace proof, preserving complete artifact and live-checkout rechecks without reopening the store for each predecessor:

- Responsibility claim admission and its effect adapter.
- Canonical owner-reasoning facts during planning and repeated admission.
- Native dispatch planning.
- Canonical workspace preparation.
- Ready-workspace receipt recovery.
- Worker-process admission.

Connection sharing grants no authority or cached proof. All five-second readiness, lease, and final-admission checks remain unchanged.

After canonical task context is bound, final verification, provider login and runtime, knowledge, and repository probes run concurrently. Login precedes runtime within its provider probe. Each independent result supplies only its own checks; another probe's earlier positive seed cannot replace a negative result. Both preceding task and source/authority admissions settle before context loading. All final probes settle before the shared reader closes or any effect begins, even if one fails.

Supplied application readiness retains the concurrent final-probes-and-admission path. Execution then rechecks the current mandate and applies unchanged five-second admission and readiness bounds. This ordering creates no cached observation or additional authority.

### Repository coordination

Repository coordination resolves the Git worktree root and common directory in one fresh Git invocation. Exact project-root comparison, common-directory inspection, private marker validation, and worktree-shared authority remain mandatory. Partial, ambiguous, multiline, or malformed coordinates fail closed. The single invocation removes duplicate process startup without caching repository identity.

Assignment listings resolve repository coordination once per call and validate every record and current role against that freshly observed collection. Neither coordinates nor assignment values persist across calls.

## Evidence and failures

A positive application knowledge check is supplemented only when both scans:

- Belong to the plan's project.
- Completely cover the configured source set.
- Agree on source snapshot and policy hashes.

For scoped dispatch, normalization must have no pending document within the plan's expected paths, and lint must be valid with no errors. Warnings about unrelated document normalization or rebuildable structural materialization do not invalidate exact source bytes but remain visible in knowledge lint. Unscoped observers require zero pending normalization and zero lint issues. Loaded context, required path hashes, and later task-specific evidence remain independent checks.

Dispatch and final effect preflight must observe the same complete repository source snapshot. Any intervening source change blocks the effect, including changes outside the task's expected paths. A fresh cycle re-observes the repository without reusing the prior snapshot.

Any of these conditions changes a positive knowledge check to `unobserved` with a null evidence hash:

- An open materialization transaction.
- Incomplete coverage.
- Changed source or policy.
- Project mismatch.
- Pending normalization within a required path, or any pending normalization for an unscoped observation.
- A lint error, or any lint issue for an unscoped observation.
- An inspection exception.
- Inspection or subsequent use outside zero to sixty seconds from the first scan.

Failed, unobserved, not-required, missing, and missing-hash application checks are never promoted. Preserve the original readiness observation time: fresh repository inspection cannot refresh stale task-context evidence.

Combined evidence hashes bind prior application evidence, project identity, source snapshot, policy, normalization report, lint result, and knowledge observation and expiration times. Combined readiness cannot expire after the knowledge inspection. Readiness exposes no raw repository paths, source bodies, document names, or unrestricted errors. Existing knowledge transaction and readiness contracts define failure meaning; this adapter adds no event fields, persistent state, or authority.

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
