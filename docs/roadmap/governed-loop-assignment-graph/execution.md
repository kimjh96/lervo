# Governed execution and authority

These completed bounded manual slices share the [roadmap's responsibility boundaries and non-goals](../governed-loop-assignment-graph.md).

## GLA1: First vertical slice

The first slice provides:

- A graph projection over current-workstream assignments: roots, parallel ready nodes, joins, exact approval-requirement digests, leases, and attempt counts.
- Cycle, self-dependency, duplicate, and cross-workstream dependency findings.
- One governed decision for claim, start, retry, approval wait, dependency wait, cancellation propagation, block, escalation, or completion.
- At most 16 attempts per assignment and 32 parallel assignments. Active attempts consume capacity before another claim, start, or retry is recommended.
- Exact provider, resource-scope, and accounting-descriptor token admission thresholds. No addition across providers, scopes, or descriptors; no advance-reservation claim.
- Complete, partial, unavailable, and invalid resource handling, never inferred zero.
- Assignment- and agent-bound causal root and retry records.
- Fail-closed attempt-to-assignment and provider-resource attribution checks.
- Manual `lervo loop status` and `lervo loop run` routes over the same public application contract.
- Provider-run success finalization only after verification and writing publication pass.

The controller retains no mutable loop state; restart and resume replay canonical state. A completed managed run with an unobservable assignment-finalization outcome becomes `completion_reconciliation_required` and is not automatically rerun.

Acceptance requires focused tests for parallel roots and a join, exact retry ancestry, approval blocking, cancellation propagation, resource exhaustion and missing-telemetry behavior, managed-run causal binding, CLI port composition, and no new canonical store. Quality, type, package-boundary, build, relevant full tests, documentation lifecycle, and task-base release-completion checks must pass with reviewed minor release intent.

## GLA2: Authority and cancellation transition

The provider-neutral approval-authority query/observation port is storage-neutral and requires exact assignment, requirement-digest, evidence-hash, and validity-interval bindings. Duplicate, foreign, malformed, or expired evidence fails closed. Approval matches the exact assignment requirement; digest-only approval sharing is insufficient.

The default CLI has no authority adapter: approval-gated assignments remain `await_approval`, and command-line text is not authority. GLA2 adds no approval issuer or model self-approval inference and does not make the controller effectful.

Cancellation uses a content-addressed, deterministic single-assignment plan bound to the current revision and status, with the distinct `assignment.cancelled` transition. Only queued or blocked work is cancellable. Leased work remains protected after expiry because expiry does not prove provider termination; GLA2 does not cancel leased provider work.

Requested and dependency-driven cancellation use exact plan/apply CLI composition. Dependency propagation is explicit and incremental, never a hidden multi-assignment transaction. The transition provides state/event rollback with the privacy-bounded `assignment.cancelled` event.

## GLA3: Prepared completion reconciliation

Privacy-bounded completion preparation is recorded after managed verification and writing-publication acceptance, before ordinary assignment finalization. Matching preparation permits an exact report-bound plan/apply reconciliation without rerunning provider work. Missing or stale preparation remains escalation-required. Lease expiry alone never makes a completed attempt claimable again.

Acceptance requires focused tests for canonical run and result binding, foreign or malformed preparation rejection, no reclaim after verified completion, explicit no-write planning, exact stale-plan recheck, expired-original-lease recovery, and state rollback when reconciliation-event persistence fails. Quality, type, build, full tests, documentation and knowledge lifecycle, foundation checks, and task-base release completion must pass with reviewed minor release intent.

## GLA17: Managed execution resource budget policy

GLA17 preserves total-token admission and adds independent input, cached-input, output, reasoning-output, and per-run managed-stage duration limits. Exact resource and stage projections feed one controller-owned assessment; the CLI and operating client only parse or render it. Duration uses the maximum matching run, never summed cross-profile or concurrent elapsed time.

Configured limits fail closed before the next attempt and after an otherwise accepted provider run but before assignment completion. Partial, unavailable, invalid, absent, or ambiguous evidence remains unknown. Direct-terminal whole-task usage, monetary cost, future reservation, and in-flight preemption remain unsupported.

Acceptance requires focused tests for legacy total-token compatibility, dimension separation, exact resource and stage coordinates, inclusive thresholds, no cross-profile duration addition, missing observation failure, controller-owned operating projection, CLI parsing and exit status, and post-run assignment rejection. Quality, type, package-boundary, build, full tests, documentation and knowledge lifecycle, and task-base release completion must pass with reviewed minor release intent.
