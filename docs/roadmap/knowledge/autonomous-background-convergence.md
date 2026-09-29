# Autonomous background knowledge convergence

Status: `in_progress`
As of: 2026-09-28

## Outcome

Drain existing and newly created canonicalization, normalization, and knowledge debt through accountable background agents without waiting for another human turn. [ADR-0434](../../decisions/knowledge/repository/canonicalization/0434-converge-background-canonicalization-normalization-and-knowledge.md) and the [implementation contract](../../specs/background-knowledge-convergence.md) define the design. The [audit](../../evidence/quality/background-knowledge-convergence-audit.md) records current defects and evidence limits.

The local runtime is implemented. A [privately installed native Codex canary](../../evidence/quality/background-knowledge-convergence-implementation.md) verified changed canonical drafts through independent review, real Git integration, normalization, and no-Hub currency; earlier canaries verified restart and the last idle document edit. Focused recovery covers failed-assignment reopening, verified Git completion before root apply, safe workspace cleanup/archival, successive integration generations, new source roots, and exact normalization lineage. Production fleet activation and remaining installed acceptance gates are open. Cleaning the current backlog alone cannot satisfy this outcome.

## Delivery order

1. Repair settlement safety. Add source/context rechecks and exact lease fencing after review and before outcomes. Validate complete source manifests, recover pinned before-bytes, partition opaque assets, and forbid null-candidate `pending_review`. Add regressions for the two reproduced unsafe paths before changing production behavior.
   Use [ADR-0436](../../decisions/knowledge/repository/canonicalization/0436-reviewed-source-capture-and-bounded-canonical-worksets.md) for reviewed capture ceilings, complete opaque link descriptors, and canonical worksets that honor delegated count and byte bounds; require actual target/asset verification before full baseline currency.
   Use [ADR-0438](../../decisions/knowledge/repository/canonicalization/0438-bind-bounded-asset-manifests-to-delegation.md) to bind larger complete asset declarations in one bounded sidecar and atomic delegation plan; install compatible readers before activating exact project authority. Integrity declarations cannot promote visual or runtime state.
2. Implement canonical baseline discovery and durable stage handoff. Replay change events omitted from full queues and recover acknowledged attention/review outcomes without changing historical events. Expose independent debt and worker health before enabling document writes.
3. Implement reviewed delegation, independent review assignments, and scoped workspace/integration composition. Reuse existing role, ancestry, capability, verification, path-conflict, document-layout, and exact apply gates. Without delegation, inspect and report only.
4. Connect canonical assessment to authorized draft integration and exact promotion. Resolve candidates semantically, not merely by canonical path presence. Recovered historical obligations retain their source-evidence limits.
5. Connect normalization generation to autonomous review and exact apply. Include fairness, rejection isolation, finite resources, provider pause, and self-generated-change suppression. Reconcile bridges and projections after approved writes.
   Preserve rejected canonical proposals as unresolved evidence while continuing independently reviewable normalization under [ADR-0435](../../decisions/knowledge/repository/canonicalization/0435-continue-normalization-after-canonical-rejection.md); require installed evidence that this continuation never claims canonical acceptance or baseline currency.
6. Connect ordered lifecycle verification to change-scoped and repository-wide completion. Require stable scans, stage receipts, zero lint errors, and explicit unresolved-debt accounting. Keep partial completion visible.
7. Complete reader-first compatibility, dry-run baseline migration, and one installed idle canary. Activate further repositories only after verified no-Hub/restart/conflict/provider-capacity journeys and reviewed per-project authority.

## Acceptance gates

- [x] A repository with old debt and no new conversation is discovered on startup and progresses through independent review, integration, normalization, and verified currency.
- [ ] The last document edit before idle triggers processing; terminal, managed run, Discord, and canonical integration all preserve one source obligation per observed change.
- [x] Complete execution history can grow beyond the current corpus bounds under a reviewed pagination or compaction contract, preserving all canonical originals and exact coverage. [ADR-0440](../../decisions/knowledge/repository/canonicalization/0440-page-complete-execution-evidence-for-canonicalization.md) implements complete bounded pages with unchanged original identities and combined scanner policy. [Installed evidence](../../evidence/quality/background-knowledge-convergence-implementation.md#complete-installed-execution-evidence) verifies 18,084 exact originals beyond 16 MiB, successful full migration and valid lint at the earlier 18,084-event checkpoint. Its 2026-09-29 capacity review raises only this repository's tracked source ceilings for the later 38,583-event population; fresh migration and lint remain required before claiming that population. [ADR-0437](../../decisions/knowledge/repository/0437-stream-validated-recent-execution-evidence.md) repairs interactive startup only; recent-window readiness does not satisfy this condition.
- [ ] Event/outbox transactions prove no lost continuation at capacity, acknowledgement, cursor advance, or process death; replay creates no duplicate provider work or integration.
- [x] Source or instruction drift during review never records `current`; stale leases, CAS mismatch, unsafe paths, and unsupported readers cannot settle success.
- [x] Every `pending_review` binds a real candidate/decision, owner, and scheduled continuation. Candidate rejection or promotion advances or preserves its exact obligation.
- [x] Pinned older Git blobs remain reviewable beyond four commits; unreconstructable dirty history cannot be invented or silently upgraded.
- [ ] Mixed text and binary assets receive complete typed dispositions. Generated cache exclusion requires repository-governed evidence and never drops tracked assets.
- [x] Generator and reviewer assignments remain distinct. Exact per-source review rejects semantic omissions, and no provider or candidate self-approval authorizes user-owned rewrites.
- [x] A fresh installed Shiflo review receives the three linked screenshot reproduction contracts under [ADR-0443](../../decisions/knowledge/repository/canonicalization/0443-load-linked-child-contracts-for-canonical-review.md), verifies substantive exact quotations, and records accepted canonical coverage or an explicit remaining rejection.
- [ ] Live writers, dirty target bytes, revoked delegation, and changed integration heads preserve user work. An accepted branch alone does not satisfy integration.
- [ ] A source replica between hosts with distinct workforce identities leaves each host's reviewed convergence delegation unchanged while synchronizing canonical knowledge and asset dispositions.
- [ ] Crash before/after journal apply and outcome append recovers as verified apply, verified rollback, or owned uncertainty, with no duplicate write or model rerun.
- [ ] Quota/authentication, cancellation, missing usage, resource ceilings, exhaustion, and a rejected leading family remain visible and do not hot-loop or starve unrelated authorized work.
- [ ] A full installed verification outlives 30 minutes while its exact assignment lease renews and all four shards settle under [ADR-0359](../../decisions/execution/verification/0359-renew-assignment-leases-during-long-verification.md); an expired claim cannot turn a failed run into success.
- [x] A stable source reaches a bounded fixed point: normalization-produced writes cause no endless candidate regeneration, and zero debt produces no provider calls.
- [x] Both Codex and Claude pass the same review, no-capability, usage, cancellation, and failure contracts. Provider configuration stays behind adapters.
- [x] CLI and Node hosts share ownership; host-wide resource admission is observed, not inferred from repository-local locks.
- [x] Current status distinguishes source-scoped success from complete baseline currency and never infers either from an empty queue, valid lint alone, or transport health.
- [ ] Installed canary evidence proves target byte receipt, current normalization records, bridge/projection currency, semantic debt closure, no-Hub behavior, restart, and live-response latency while background work is busy.
- [ ] The standalone Node's owned resident child preserves shutdown and parent-loss
      cleanup while a fresh human Discord question succeeds during actual background
      work. [ADR-0441](../../decisions/knowledge/repository/canonicalization/0441-isolate-resident-knowledge-from-node-conversations.md)
      separates execution processes; source tests alone do not prove installed latency
      or resolve independent manifest replacement and task-source drift.
      [ADR-0442](../../decisions/knowledge/repository/canonicalization/0442-isolate-conversation-repository-snapshots.md)
      also moves managed conversation snapshots out of the busy Node event loop after
      the first installed child rollout still recorded a 30-second snapshot failure.
- [ ] Installed managed conversations and background materialization share the
      repository source gate from [ADR-0444](../../decisions/knowledge/repository/canonicalization/0444-serialize-knowledge-materialization-with-managed-runs.md):
      a fresh published conversation keeps its snapshot stable during an active
      convergence cycle, a deferred reviewed apply retries and reaches current after
      the conversation settles, and a process exit or interrupted journal recovers
      without accepting an unmanaged source change.

Observed gates above are supported by the implementation evidence and focused tests; shared provider contracts do not imply a successful native Claude journey. Unchecked compound gates retain their unobserved portions: all producer surfaces under installed operation, capacity/process-death handoff, complete asset policy coverage, concurrent live-writer and dirty-target journeys, all journal/integration crash windows, and installed response latency.

## Validation and rollout

Before implementation completion, run structural review, focused lifecycle/provider tests, quality checks, and the task-base-bound release completion check with reviewed CLI/private release intent. Run `lervo migrate knowledge` and `lervo knowledge lint` on the implementation repository. Reader and writer rehearsal must cover every installed consumer before activation.

The existing 311-document inventory is a bounded starting observation, not a fixed workset or automatic approval. Capture fresh per-project sources and review authority before generation or cleanup. AXLI's product-verification configuration and Kael's provider quota are separate prerequisites; this design grants neither new tools nor extra usage.

The installed Lervo normalization apply exposed a 900-second full-test timeout in `repository.default.v4` while 353 worktree paths selected the full suite. The four-worker, 1,800-second version-five attempt also reached its command limit without a passing apply. [ADR-0354](../../decisions/execution/verification/0354-shard-full-runtime-verification-on-busy-hosts.md) splits the same selected tests into four bounded Vitest commands. A local version-six shard exposed a thread-pool incompatibility; [ADR-0355](../../decisions/execution/verification/0355-use-fork-backed-runtime-shards.md) switched to fork workers. A repeat of a version-seven shard exposed the default per-test timeout under host load; [ADR-0356](../../decisions/execution/verification/0356-bound-test-deadlines-for-busy-host-shards.md) records the explicit 15-second deadline. The installed version-eight canonical candidate failed type checking without isolated workspace dependencies; [ADR-0357](../../decisions/execution/verification/0357-prepare-isolated-candidate-verification-workspaces.md) adds offline candidate preparation. A second installed version-nine attempt passed two full shards before a 30-second native recovery test deadline failed; its 30-minute stage lease also left too little time for the final shard. [ADR-0358](../../decisions/execution/verification/0358-cover-busy-host-verification-stage-leases.md) bounds both durations. The next installed apply exposed two 60-second full-worker test limits; the corrected tests passed in a focused WSL run, and the longer-lease r159 Node is ready. Completion still requires the source-bearing integration ref, the exact reviewed version-nine delegation, passing installed canonical integration and normalization apply, and a current knowledge receipt.
