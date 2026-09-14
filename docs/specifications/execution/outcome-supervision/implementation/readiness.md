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

For dispatch, retry, and owner execution, Node obtains readiness again before its final admission observation and evaluates it after asynchronous authority reads. Future observations, observations older than five seconds, expired checks, missing evidence, and negative dispositions prevent effect invocation. `supervision_readiness_changed` identifies an invalid binding. A typed final-preflight failure reports `supervision_preflight_failed` and retains the recorded decision for independent non-start inspection before replay. Failures after effect invocation retain uncertain execution for reconciliation.

On every execution preflight, Node independently:

- Observes the [canonical assignment, ancestry, lease and Git workspace](repository-readiness.md).
- Inspects [host filesystem access for exact plan and responsibility paths](path-readiness.md).
- Recovers the [latest responsibility from binding history and CAS](storage/responsibilities.md).
- Adds [configured executable observations](runtime-readiness.md).
- Observes [native stored-login status](login-readiness.md) without treating it as remote authentication or task permission.
- Inspects [control-repository knowledge currency](knowledge-readiness.md).
- Validates [pinned verification definitions and working directories](verification-readiness.md).

## Permission-failure evidence and recovery

An operating-system permission denial (`EACCES` or `EPERM`) on the configured provider executable, a mapped verification tool, or the native login probe is an observed failure, not an unobserved probe. The affected provider, tool, or required CLI check becomes `failed` with an evidence hash binding the prior application evidence, the configured executable identities, and the normalized probe result. A missing executable, timeout, or unrecognized response still leaves the check `unobserved`.

When the worker preflight of a recorded decision reports at least one `readiness_<kind>_failed` code, the runtime records `work.supervision.readiness.failed` for that decision before blocking. The decision keeps `recorded` status; no effect, lease, or provider process is claimed. Repeating the same failed checks appends nothing. The next cycle reinspects the same decision: after the host repairs the permission, fresh readiness passes and the original admitted decision executes without a new proposal. Reassignment stays behind the existing unstarted-responsibility revision after the exact lease expires; a live lease is never edited. Neither the event nor a later ready observation proves the resumed execution; only the decision's confirmed effect does.

The application supplies a matching task view and authentication, tool-permission, policy, budget, and process evidence. Repository probes cannot turn missing application evidence into a pass. Responsibility installation remains open. The effect adapter rechecks exact admission at its own commit boundary.
