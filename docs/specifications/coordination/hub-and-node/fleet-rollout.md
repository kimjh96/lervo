# Organization fleet rollout

## Enrollment and waves

Organization enrollment binds an active delivered credential to the deterministic repository service instance, runtime artifact, local onboarding plan and apply receipt hashes, and three complete online readiness observations. It excludes paths, service bodies, credential sources, and secret material. `offline_ready` suffices only for a bounded registered replacement in the local lifecycle; it cannot establish first organization admission.

A rollout names every enrolled target exactly once. A multi-Node rollout starts with one canary. Each wave grows by at most twofold, contains at most 32 Nodes, and permits zero unavailable Nodes. Advancement requires the exact target version and artifact, event synchronization, workstream replication, and three consecutive complete readiness observations. Pending evidence holds. Degraded, unavailable, stale, version-mismatched, or artifact-mismatched evidence requires an explicit rollback decision.

Planning, observation, approval, execution, and rollback remain separate. The planner cannot approve its plan; the approver cannot execute the approved action. First-wave execution requires explicit approval. Later execution binds the exact prior ready observation; rollback binds the exact current failed observation. Plans, observations, and approvals claim no service effect.

## Node execution and forward delivery

One Node-scoped execution plan may bind an approved `execute_wave` member to its exact current local plan ID and hash, target executable artifact, repository identity, destination, and executor. Apply revalidates every organization and local binding before invoking the existing local Node transaction. Its secret-free receipt proves only that Node's complete online apply; wave observation still controls advancement.

An installed CLI receiver accepts the complete forward plan only through a bounded owner-only signed request and scoped Ed25519 trust manifest. It re-derives project identity, requires the delivery signer principal to equal the recorded approver, recalculates the local plan, and durably reserves delivery hash, idempotency key, nonce, and a path-free recovery baseline before apply.

A completed duplicate returns the same stored receipt. An interrupted or unpersisted effect remains `in_progress` and is never rerun automatically. Recovery compares the baseline with an exact current replan, persists `applied`, `not_applied`, or `unknown`, and never synthesizes an execution receipt.

## Predecessor rollback

A separate one-Node rollback plan binds an exact failed target observation to the distinct predecessor version and artifact recorded by enrollment. Its installed adapter verifies both executable artifacts, the failed service definition, registry state, and current predecessor plan before invoking the explicit local service rollback action. Complete online readiness precedes predecessor registry commit; pre-commit failure attempts exact forward compensation.

The low-level adapter grants no signed delivery or replay authority. The installed receiver below adds those controls but grants no unattended delivery. Neither boundary is a Hub endpoint, Node daemon transport, or multi-Node transaction.

## Installed rollback receiver

The receiver accepts a distinct signed rollback envelope through owner-only request and trust files. It revalidates the exact predecessor plan, reserves a rollback-specific SQLite replay coordinate before mutation, returns completed duplicates, and leaves uncertain effects fenced.

Recovery inspects exact predecessor disposition and persists `rolled_back`, `not_rolled_back`, or `unknown` without invoking rollback. This is a one-Node local process boundary, not a Hub endpoint, daemon transport, automatic selector, or multi-Node transaction.

## Acceptance boundary

Installed three-Node acceptance composes these Node-scoped boundaries through a one-Node canary and two-Node expansion. Only a complete canonical wave observation permits advancement. Pending evidence holds; an exact degraded target permits explicit rollback of that Node alone. Acceptance verifies orchestration boundaries, not live-machine operation, unattended automation, or cross-Node atomicity.

See [ADR-0229, ADR-0232 through ADR-0236, and acceptance evidence in the coordination references](../hub-and-node.md#references).
