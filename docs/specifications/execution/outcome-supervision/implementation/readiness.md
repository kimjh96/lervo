# Responsibility and readiness

## Responsibility binding

Responsibility validation binds the assignment revision, executor, reviewer, exact role version and hash, acceptance criteria, artifacts, handoff recipients, and ordered finite deadlines. A predecessor mismatch or unresolved live lease blocks rebinding. Role version one uses the repository's semantic version format.

## Readiness evidence

Readiness binds current source, exact responsibility, worker identity, role, and observation expiry. Every provider, tool, CLI, read/write scope, knowledge, source policy, verification, budget, workspace, ancestry, and lease check requires a disposition and evidence hash. Required checks cannot be `not_required`; passed checks without evidence cannot admit dispatch.

The controller derives minimum conditional checks from the bound responsibility:

- `shell.execute` requires CLI readiness.
- `filesystem.write` or `repository.write` requires write-scope readiness.
- `network.access` requires source-policy readiness.

An empty adapter-required list cannot remove these checks. Task adapters must add requirements absent from these capabilities, including research source policy for offline research. Capability-derived checks neither establish research acceptance nor prove actual inspection of a provider, tool, or policy.

## Node binding and admission

Node accepts readiness observations at the application task digest and binds a detached copy to its combined task/authority digest. The exact responsibility artifact, role, owner-execution identity, required capabilities, and paths must fit the reviewed plan. A different raw digest cannot be relabeled as current evidence.

For dispatch, retry, and owner execution, Node obtains readiness again before its final admission observation and evaluates it after asynchronous authority reads. Future observations, observations older than five seconds, expired checks, missing evidence, and negative dispositions prevent effect invocation.

- `supervision_readiness_changed` identifies an invalid binding or negative final evaluation.
- `supervision_readiness_stale` identifies an observation older than five seconds at effect time.
- `supervision_knowledge_snapshot_changed` identifies a knowledge snapshot that differs between the cycle's readiness read and final preflight.
- `supervision_mandate_source_changed`, `supervision_task_source_changed`, and `supervision_plan_source_changed` distinguish the exact digest boundary that changed before final admission. They carry no source path or content.
- `supervision_admission_stale` means the final admission observation missed the five-second window; `supervision_admission_rejected` means the reviewed plan was not admitted against the freshly read snapshot. Neither permits the effect to start.

A typed final-preflight failure reports `supervision_preflight_failed` with the bounded cause code (or `preflight_cause_unclassified`) and retains the recorded decision for independent non-start inspection before replay. Failures after effect invocation retain uncertain execution for reconciliation.

On every execution preflight, Node independently:

- Observes the [canonical assignment, ancestry, lease and Git workspace](repository-readiness.md).
- Inspects [host filesystem access for exact plan and responsibility paths](path-readiness.md).
- Recovers the [latest responsibility from binding history and CAS](storage/responsibilities.md).
- Adds [configured executable observations](runtime-readiness.md).
- Observes [native stored-login status](login-readiness.md) without treating it as remote authentication or task permission.
- Inspects [control-repository knowledge currency](knowledge-readiness.md).
- Validates [pinned verification definitions and working directories](verification-readiness.md).

The application supplies a matching task view and authentication, tool-permission, policy, budget, and process evidence. Repository probes cannot turn missing application evidence into a pass. Responsibility installation remains open. The effect adapter rechecks exact admission at its own commit boundary.

Canonical worker budget readiness follows the exact installed mandate rather than an unconditional cumulative-usage rule. For a V3 mandate with reviewed `aggregateTokenPolicy.mode: per_attempt_only`, missing historical aggregate usage does not make the budget check unobserved; the readiness evidence binds the mandate hash and policy mode. For cumulative mandates, resource admission must still be `within`. The independent policy review continues to enforce the per-attempt token ceiling, retry count, and all other mandate limits before any effect. A changed or mismatched installed mandate fails the binding instead of silently changing readiness policy.

## Permission-failure evidence and recovery

See [permission-failure evidence and recovery](readiness/permission-failures.md) for executable permission denials, failure recording, and resuming the original decision.
