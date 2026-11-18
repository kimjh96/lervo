# Autonomous background knowledge convergence

Status: `in_progress`
As of: 2026-10-08

## Outcome

Drain existing and new canonicalization, normalization, and knowledge debt through accountable background agents without another human turn. [ADR-0434](../../decisions/knowledge/repository/canonicalization/0434-converge-background-canonicalization-normalization-and-knowledge.md) and the [implementation contract](../../specs/background-knowledge-convergence.md) define the design; the [audit](../../evidence/quality/background-knowledge-convergence-audit.md) records defects and evidence limits.

The local runtime is implemented. A [privately installed native Codex canary](../../evidence/quality/background-knowledge-convergence-implementation.md) verified changed canonical drafts through independent review, real Git integration, normalization, and no-Hub currency. Earlier canaries verified restart and the last idle document edit. Focused recovery covers failed-assignment reopening, verified Git completion before root apply, safe workspace cleanup and archival, successive integration generations, new source roots, and exact normalization lineage.

[ADR-0466](../../decisions/coordination/sync/0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md) cross-host ownership is implemented in source through a Hub owner lease, commit fence, and standalone contention detection. The [October 8 installed maintenance evidence](../../evidence/quality/knowledge-maintenance-recovery-and-speed-implementation.md) records a WSL owner and a Mac follower waiting for that owner. These observations do not establish the complete [cross-host ownership acceptance](autonomous-background-convergence/acceptance/integration/cross-host-ownership.md), including takeover and seven-day ownership evidence.

The first maintenance recovery delivery is installed on Mac and WSL, with reader deployment and scoped Lervo schema-5 activation recorded separately from complete fleet acceptance. Remaining installed acceptance gates stay open. Backlog cleanup alone does not satisfy the outcome.

## Plan and evidence

- [Delivery order](autonomous-background-convergence/delivery.md): settlement safety, delegation, integration, normalization, and lifecycle completion.
- [Acceptance gates](autonomous-background-convergence/acceptance.md): observed completion and remaining installed requirements.
- [Validation and rollout](autonomous-background-convergence/rollout.md): activation prerequisites and installed verification history.
- [Maintenance recovery and speed](maintenance-recovery-and-speed.md): first delivery and installed reader evidence for evidence recovery, bounded preparation, and metadata status; complete scheduling, safe-effect protocols, recovery outcomes, and seven-day performance acceptance remain pending.

## Capacity and optional-context recovery acceptance

[ADR-0532](../../decisions/knowledge/maintenance/0532-continue-background-review-past-capacity-and-optional-context-failures.md) adds source changes and focused tests for the reported axli and flemo stops. Tests are not executed in this task at the owner's request. Installed acceptance remains pending: observe capacity-blocked sources parked with other coverage retained, generated paths absent from assessment, optional context failures recorded without stopping assessment, required instructions failing closed, and both obligations reaching normalization without interrupting development. Existing canonical-folder capacity repair is separate reviewed work.

## Bounded storage acceptance

[ADR-0534](../../decisions/operations/storage/0534-bound-installed-runtimes-and-convergence-artifacts.md) adds managed runtime retirement and project CAS collection. Source implementation and focused test cases are present. Tests remain unexecuted by explicit owner instruction. Installed acceptance must verify reclamation and continued rollback, normalization lineage, parked-source status and historical settlement on both Mac and WSL. Record actual reachable bytes and reclaimed bytes; disk totals alone do not establish savings. [ADR-0585](../../decisions/operations/storage/0585-release-mirrored-backups-and-settled-assignment-inputs.md) releases mirrored event-writer backups and settled assignment inputs. Before that release deletes anything on a host, record its `lervo state cas-retention --plan --json` output. Baseline/capture envelope deduplication remains a separate compatibility follow-up.

## Deferred migration document acceptance

ADR-0540 requires focused and installed evidence that every migration candidate is moved, retained with evidence, or deferred with a stated resolution. Acceptance also requires foreground root-document classification, background classification outside delegation roots, the unchanged write fence, one exact-path renewal proposal, and exposed count and oldest-deferral age for ADR-0535. Acceptance includes authority checks before full-body review, conflict outcomes for every source, real paused-admission fallback, complete source/destination/reference scope, evidence-bound decline settlement, an accepted-decision-to-move lifecycle, and unknown oldest age after bounded-history overflow. Tests and an installed CLI smoke assertion are written on the implementation branch. Execution remains pending under the owner's instruction not to run tests. Proposals beyond the existing 32-root contract are no longer asked: [ADR-0559](../../decisions/knowledge/documents/routing/0559-ask-one-owner-decision-for-a-reviewed-layout-plan.md) asks the same moves as one layout decision with one accept and one decline command. It is `wired` with focused tests and a read-only check on argo (one decision for 20 moves); acceptance on argo and Discord delivery, which waits for the ADR-0453 escalation path, remain open.

## Runtime provider admission acceptance

[ADR-0536](../../decisions/execution/providers/admission/0536-admit-provider-clis-by-contract.md) adds installed executable detection, identity-bound no-capability admission, delegation-bounded fallback, waiting/readmission, continuity records, and service planning without frozen provider directories. Focused regression tests are authored; this implementation task explicitly does not execute tests.

Acceptance remains open until focused suites run, compatible readers are deployed on both hosts, ADR-0535 consumes the admission projection, and installed Mac `lervo` convergence is observed leaving `knowledge_compile_policy_violation`. Preserve the unchanged Codex probe and Claude no-tool boundary throughout rollout. No installed or cross-host success is inferred from type or quality checks.

The ADR-0536 adversarial revision adds strict Claude probe proof, per-call file identity checks, login PATH propagation, shim discovery, paid-probe budgets and backoff, serialized host-cache writes, legacy background normalization admission, and worker-observed continuity selection. Focused regression coverage includes real resolver/host waiting and readmission, replacement of a frozen service definition, and empty `HOME`/`SHELL`. Tests remain authored and unexecuted under the owner’s constraint. Installed Mac recovery, cross-host parity, and ADR-0535 integration remain acceptance gaps.

The remaining ADR-0536 verification findings add version-output identity checks for shim dispatch, provider-local pause fallback, and a separate cache for unprobed detection identities. Authored regressions cover unchanged-shim version changes that stop a batch, paused preferred Claude with allowed Codex execution, native candidate cache reuse, and detection through execution with empty `HOME` and `SHELL`. Acceptance requires executing these regressions when authorized.

The NULL-reset pause addition schedules native re-probes after one hour, doubles delays to a 24-hour cap, and preserves newer failures through compare-and-settle recovery. It reuses paid-probe budgets and usage records. Disallowed providers remain paused and visible through admission continuity findings with age and next eligibility. Acceptance also requires running the authored backoff, recovery, newer-failure, and excluded-provider regressions when authorized.

The final ADR-0536 verification revision unifies shim dispatch at a neutral cwd with one allow-listed environment, separates read-only admission inspection, and normalizes automatic native re-probe timeouts and validation failures without swallowing authority or budget errors. Acceptance also requires running the authored cwd-dispatch, database immutability, continuity failure isolation, and re-probe fallback regressions. These tests remain unexecuted under the owner’s constraint.
