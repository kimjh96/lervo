# Background convergence recovery and retention

Status: `active`
As of: 2026-09-28

## Assignment failure and retry

A stopped stage failure stores a private CAS receipt binding the exact assignment contract, input, lease ID and generation, normalized code, upstream evidence hash, and return time. Returning that exact lease records a failed assignment; it never accepts provider output or grants another write. Revocation permits failure bookkeeping but denies new document effects. Lost or expired authority cannot be silently replaced.

Retry requires the exact canonical failed completion and private artifact, current source and delegation, and a resolved stopped dependency. It reopens the same assignment with predecessor contract and responsibility hashes, terminal event ID, and increasing lease generation. Sixteen attempts remain the hard bound. Provider reservations survive retries: semantic stages permit at most three calls per stage batch within the delegation ceiling; normalization generation and review retain their shared eight-call bound. An unknown native reset still requires an exact successful availability probe.

Generator and reviewer identities retain the existing parent's read responsibility. New source roots can enter later baselines without widening parent authority or writer paths. Writer and integrator assignments remain limited to approved target paths. A legacy narrow reader may be replaced once by a stable identity bound to the existing parent responsibility; it receives no new write authority.

## Known effects and uncertainty

Private effect checkpoints persist provision, seal, integration plan, candidate, verification, completion, and integrator closure before their host effect. The owner-only SQLite projection retains at most 8,192 coordinates and prunes only canonically terminal obligations. Each checkpoint binds assignment, exact input, full lease and generation, effect name, and CAS hash. It cannot revive an expired lease.

Same-lease retries inspect actual Git metadata, markers, workspaces, and exact plans rather than creating another checkout or commit. Each new assignment lease owns a separate private workspace path. Integration uses the approved single-source fast-forward strategy with exact target compare-and-swap and verification. Shared target generations advance beyond actual completed attempts independently of assignment lease generations. An uncompleted target attempt blocks a new generation; a diverged target is never forced.

A new exact integrator lease may resume repository materialization after completed Git integration only when the canonical integration event, actual attempt, sealed source, approved drafts, verification artifacts, pinned suites, delegation, exact current ref, and source bytes all agree. This observation neither moves Git again nor repeats model review. Advancing, incompletely recorded, divergent, expired, or unknown effects remain `recovery_required`; an exact durable journal still owns recovery.

An independently reviewed normalization can change canonical working-copy bytes after Git integration. Later canonical integration accepts that preimage only through hash-linked successful canonical normalization stages and their private receipts, with matching project, policy, delegation, distinct reviewer, writer completion, exact updated path, and verification. At most sixteen transitions in the latest 10,000 canonical events are inspected. The final hash must equal the current reviewed source and the initial hash the actual target blob. Manual edits, new/deleted targets, missing proof, or unavailable older lineage retain `canonical_target_diverged`. Arbitrary dirty bytes receive no approval.

## Watch notification recovery

Local source subscriptions compare a disposable metadata fingerprint every sixty seconds when native filesystem notifications are silent. A changed fingerprint emits only a hint; authoritative source capture and admission still run before effects. The [replica subscription contract](../../specifications/coordination/node-change-driven-work/repository-replicas.md) defines its bounded inputs and shutdown behavior.

The [unattended scheduler](../../specifications/coordination/node-change-driven-work/conversation-scheduling.md) also probes the exact kill-switch path once per second only during an active wait. An existing entry or unexpected inspection failure wakes the authoritative scheduler check; absence does not wake it. Completion and shutdown clear both the deadline and probe timer. This safety probe does not scan repositories or create ordinary work.

## Workspace closure and retention

After verified integration, an integrator closes its clean checkout under its current lease: `active` → `sealing` → `sealed` → `integrated`. Its exact seal and canonical completed integration attempt provide evidence; only integrator workspaces permit the final direct transition. Workers retain the existing queued integration lifecycle. Closing a writer session proves no current Lervo writer; it does not infer absence of unmanaged work.

Startup can clean at most eight terminal convergence workspaces per cycle through existing exact non-force cleanup plans and journal recovery. Eligibility requires the private managed path, matching delegation/target, terminal baseline, no assignment lease or writer, clean marker/head/tree, completed integration evidence, reachability, and observed quiescence. The attempt may bind either its source workspace or its own integrator workspace. Active, failed, uncertain, foreign, and user-owned workspaces remain protected. No forced deletion or implicit discard is introduced.

At 256 assignment projections, compaction preserves the latest 128 and every active, unresolved, dependent, or remaining workspace consumer. At most sixteen canonically terminal convergence assignments are archived per cycle. Under the coordination lock, exact original file bytes enter private CAS and the canonical archive event is appended before projection removal. Append failure retains the projection; crash replay reuses the same event coordinate. Ordinary assignments, unresolved identities, canonical events, and private proof remain intact. Existing hard capacity limits stop unresolved growth.

## Archive event and privacy

Version 4 adds `assignment.convergence.archived` with required `assignmentId`, `assignmentRevision`, `assignmentHash`, `obligationId`, `terminalEventId`, `terminalEventHash`, `terminalStatus`, `archiveArtifactHash`, and `archivedAt`. IDs and hashes are bounded; `terminalStatus` is `completed`, `failed`, or `cancelled`. Unknown fields fail schema/privacy validation. Exact source bytes and paths stay in private CAS.

The event proves durable archival of one exact terminal assignment projection. It does not prove a failed result succeeded, remove a workspace, erase history, or grant retry authority. Missing terminal evidence, content drift, live consumers, or failed archival blocks removal without a success claim. Reader support and the reviewed writer transition remain prerequisites.

## Verification

Focused regressions cover exact failed-assignment reopening after a native probe, repeated provision/seal, verified integration before root apply under a new lease, integrator/source cleanup, archive append failure and dependent protection, successive target generations, new source roots, reviewed normalization lineage, and preservation of manual divergence. An actual subprocess killed after canonical file apply but before materialization evidence append restarts as owned journal uncertainty, records no currency, and invokes no provider again. The [implementation evidence](../../evidence/quality/background-knowledge-convergence-implementation.md) records installed observations and remaining unobserved windows.
