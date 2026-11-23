# Known effects and uncertainty

## Checkpoints and retries

Private effect checkpoints persist provision, seal, integration plan, candidate, verification, completion, and integrator closure before their host effect. Each checkpoint binds assignment, exact input, full lease and generation, effect name, and CAS hash; it cannot revive an expired lease. The owner-only SQLite projection retains at most 8,192 coordinates and prunes only canonically terminal obligations.

Same-lease retries inspect actual Git metadata, markers, workspaces, and exact plans instead of creating another checkout or commit. Each new assignment lease owns a separate private workspace path.

Integration uses the approved single-source fast-forward strategy with exact target compare-and-swap and verification. Shared target generations advance beyond actual completed attempts independently of assignment lease generations. An uncompleted target attempt blocks a new generation until it is released; a diverged target is never forced.

A `leased`, `candidate`, or `conflict` attempt is released when its recorded candidate is neither the target ref nor an ancestor of it, so a target that synchronization moved elsewhere does not keep it blocking. When candidate verification fails, the lease releases its own attempt before the failure propagates. When a lease ended or expired without releasing, the owner releases its attempt before it synchronizes the target and again before it plans the next generation; a restarted run of the same lease releases its own earlier attempt at that second point. A failing release is skipped, and the generation check still blocks on it. Release also returns the attempt's sealed source workspace from `integrating` to `integration_pending`, so the retry plans the next generation from the same sealed result. A released attempt still counts toward the highest generation, so no generation is reused. An `advancing` attempt, or an attempt whose candidate reached the target, still blocks with `knowledge_effect_uncertain`.

## Resuming materialization

A new exact integrator lease may resume repository materialization after completed Git integration only when all of the following agree: the canonical integration event, actual attempt, sealed source, approved drafts, verification artifacts, pinned suites, delegation, exact current ref, and source bytes. This observation neither moves Git again nor repeats model review.

Advancing, incompletely recorded, divergent, expired, or unknown effects remain `recovery_required`; an exact durable journal still owns recovery.

## Normalization lineage

An independently reviewed normalization can change canonical working-copy bytes after Git integration. Later canonical integration accepts that preimage only through hash-linked successful canonical normalization stages and their private receipts, with matching project, policy, delegation, distinct reviewer, writer completion, exact updated path, and verification.

Inspect at most sixteen transitions in the latest 10,000 canonical events. The final hash must equal the current reviewed source; the initial hash must equal the actual target blob. Manual edits, new/deleted targets, missing proof, or unavailable older lineage retain `canonical_target_diverged`. Arbitrary dirty bytes receive no approval.
