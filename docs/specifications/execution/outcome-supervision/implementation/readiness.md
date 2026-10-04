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

Canonical dispatch confirms task and authority before loading potentially expensive context. It then independently observes final mutable readiness probes and a new admission within the same bounded five-second window. The readiness witness dates those final probes only if they settle within five seconds and prepared context remains within its original validity bound. It never extends that bound or re-dates a supplied adapter observation. Earlier admission cannot serve as the final witness. Changed source, a failed final probe, or failed admission blocks worker invocation.

Failure codes distinguish these boundaries:

- `supervision_readiness_changed`: invalid binding or negative final evaluation.
- `supervision_readiness_stale`: observation older than five seconds at effect time.
- `supervision_knowledge_snapshot_changed`: knowledge snapshot differs between the cycle's readiness read and final preflight.
- `supervision_mandate_source_changed`, `supervision_task_source_changed`, and `supervision_plan_source_changed`: the respective exact digest boundary changed before final admission. These codes carry no source path or content.
- `supervision_admission_stale`: final admission observation missed the five-second window.
- `supervision_admission_rejected`: the reviewed plan was not admitted against the freshly read snapshot.

Neither admission failure permits the effect to start. A typed final-preflight failure reports `supervision_preflight_failed` with the bounded cause code, or `preflight_cause_unclassified`, and retains the recorded decision for independent non-start inspection before replay. Failures after effect invocation retain uncertain execution for reconciliation.

On every execution preflight, Node independently:

- Observes the [canonical assignment, ancestry, lease and Git workspace](repository-readiness.md).
- Inspects [host filesystem access for exact plan and responsibility paths](path-readiness.md).
- Recovers the [latest responsibility from binding history and CAS](storage/responsibilities.md).
- Adds [configured executable observations](runtime-readiness.md).
- Observes [native stored-login status](login-readiness.md) without treating it as remote authentication or task permission.
- Inspects [control-repository knowledge currency](knowledge-readiness.md).
- Validates [pinned verification definitions and working directories](verification-readiness.md).

The application supplies a matching task view and authentication, tool-permission, policy, budget, and process evidence. Repository probes cannot turn missing application evidence into a pass. Responsibility installation remains open. The effect adapter rechecks exact admission at its own commit boundary.

Canonical worker budget readiness follows the exact installed mandate. For a V3 mandate with reviewed `aggregateTokenPolicy.mode: per_attempt_only`, missing historical aggregate usage does not make the budget check unobserved; readiness evidence binds the mandate hash and policy mode. For cumulative mandates, resource admission must still be `within`. Independent policy review enforces the per-attempt token ceiling, retry count, and all other mandate limits before any effect. A changed or mismatched installed mandate fails binding instead of silently changing readiness policy.

## Permission-failure evidence and recovery

See [permission-failure evidence and recovery](readiness/permission-failures.md) for executable permission denials, failure recording, and resuming the original decision.
