# Integration, verification, and durable success

## Implementation status

Candidate-only exact Git integration is implemented behind the provider-neutral integration-host port. Plans bind the integrator assignment and writer, target ref and generation, target-before commit, ordered immutable sources, strategies, changed-path union, and path-private collision report. Apply acquires one exclusive target-generation lease, uses only the isolated integration worktree, and leaves the target ref unchanged. It records a durable candidate or aborts a Git conflict back to the exact target-before commit. Stale targets acquire no lease; competing plans cannot reuse a target generation. Lost-response retry rechecks or resets only the isolated candidate.

Repository-wide candidate verification is a non-success phase. Its plan binds every required suite ID and exact suite hash. Verification rechecks the assignment, attempt, target-before ref, candidate commit and tree, marker, cleanliness, and Git-operation state; validates every result and output against CAS; and requires an identical repository snapshot before and after execution. A content-bound receipt contains only candidate, snapshot, verification, and result-artifact coordinates.

The Git host port can advance a non-checked-out local target ref with exact compare-and-swap after rechecking candidate commit, tree, ancestry, marker, cleanliness, and Git-operation state. Inverse compare-and-swap provides idempotent rollback while retaining the candidate.

Durable integration success is implemented as a provider-neutral recovery transaction: validate the exact receipt, record `advancing`, advance an eligible target through the host port, atomically commit the authoritative `integrated` attempt with one `assignment.integration.recorded` event, then project every source workspace to `integrated`. A lost host response re-inspects and resumes the exact candidate. Failure before the authoritative event rolls the target back; interruption afterward completes missing projections without another success event. Checked-out target refs cannot advance automatically.

## Queue and plan

The bounded integration queue is a replace-current projection of durable seal and integration events. It orders completed dependencies, assignment priority, seal time, then workspace ID. Queue order grants no write authority.

A plan selects bounded sealed generations and binds:

- Exclusive integration assignment, integrator agent and workspace, target ref and generation.
- Target-before commit and repository snapshot.
- Source workspace IDs, generations, heads, trees, and dependency edges.
- Exact per-source strategy and deterministic order.
- Expected changed-path union and collision report.
- Required focused and repository-wide verification.
- Desired target commit or deterministic validation rule.

Apply uses an isolated integration worktree; any changed binding requires a new plan. A text or tree conflict aborts Git and records no success; sources remain sealed.

## Candidate preparation

Candidate preparation is non-success. Its local states are `leased`, `candidate`, and `conflict`; it never advances the target or marks a source `integrated`. Success adds `advancing` as the recovery marker and `integrated` as the authoritative state.

The target-generation lease is deterministic for repository instance, target digest, and generation; its attempt separately binds target-before. Candidate and conflict retries require the same plan hash and re-inspect marker, cleanliness, absence of Git operations, target ref, and isolated-worktree head. Collision reports contain only path digests and opaque workspace IDs.

## Verification

Verification is non-success. Planning binds ordered suite IDs and hashes. Execution accepts only the exact candidate attempt and suite definitions, emits existing privacy-bounded verification lifecycle events, validates results and output artifacts against CAS, and compares repository snapshots and host inspection before and after all suites.

Failure, cancellation, suite drift, target drift, dirty bytes, or a changed candidate produces no receipt and advances no integration state. The rebuildable receipt evidences later durable success; it does not authorize ref movement.

## Target advancement and rollback

Target advancement is separate from candidate and verification success. It accepts only the recorded target-before and candidate commit/tree, rejects a target checked out by any registered worktree, proves target-before ancestry, and uses old-value-bound Git `update-ref` compare-and-swap.

Retry accepts only the exact already-advanced candidate. Rollback accepts only target-before or that candidate and uses inverse compare-and-swap. Concurrent movement fails closed and is never overwritten. Orchestration calls advancement only after persisting an `advancing` attempt bound to the receipt hash and ordered verification-result coordinates.

## Authoritative success and recovery

After exact incorporation and verification, one coordination-record transition atomically writes the attempt's `integrated` state and `assignment.integration.recorded` event. Source `integrated` transitions are idempotent projections of that authoritative commit and must all finish before completion returns. Only then may the integrator refresh canonical documentation, advance the workstream, and make sources cleanup candidates.

Before the authoritative commit, event-write failure requires exact target rollback and returns the attempt to `candidate`. Failed rollback leaves `advancing` and blocks any different receipt. After the commit, retry verifies the same event and target, then completes only missing source projections. A different target, candidate, receipt, plan, or success event fails closed as uncertain state.

## Integrator workspace closure

After completed target integration, an integrator may close its own clean workspace through `active` → `sealing` → `sealed` → `integrated` under its current assignment lease. Direct sealed-to-integrated transition requires `executionKind: integrator`, exact verified integration evidence, and the immutable seal. Workers cannot bypass their existing integration queue.

Cleanup proof may match the completed attempt's exact integrator workspace/generation as well as a source workspace. The background recovery contract linked from the [entrypoint references](../agent-workspaces.md#references) defines bounded automatic use.
