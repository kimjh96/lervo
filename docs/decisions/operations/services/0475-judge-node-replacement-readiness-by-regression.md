# ADR-0475: Judge Node replacement readiness by regression

Status: `accepted`
Decision date: 2026-10-06
Amends: [ADR-0207](0207-transactional-repository-node-apply-and-readiness.md), [ADR-0214](0214-bounded-repository-upgrade-orchestration.md)
Amended by: [ADR-0480](0480-defer-node-cache-warmups-past-readiness.md) (starting heartbeat counts as progress)

## Context

On a WSL host with CLI 0.20.0, `lervo upgrade --apply` in the `axli` repository failed its `repository_node` stage with `node_fleet_readiness_timeout`. The replacement Node service was active. Its health snapshot showed `sync`, `workstreamReplication`, and `remoteControl` ready and `workspaceCoordination` disabled. The aggregate was `degraded` only because `supervision` reported `unavailable/supervision_attention_required` with `preflight_repair_requires_review`. That condition was an owner decision that already existed before the upgrade.

ADR-0207 readiness required the aggregate `ready`, or `degraded` caused only by `hub_unavailable`. Any unrelated pending owner decision therefore blocked every replacement. The first attempt reported `node_fleet_recovery_failed` and dropped the readiness failure that started recovery. The fixed 60-second window was also tight: that WSL Node took about 40 seconds to start synchronization.

After a successful replacement, the upgrade planner would still have reported the exact deployed runtime as `blocked/node_runtime_inspect_runtime_failure` because of the same attention.

## Decision

### Regression baseline

Before replacing an installed Node service, apply reads the predecessor's health snapshot as a baseline. A rollback reads the failed target's snapshot the same way. The baseline status is:

| Status           | Meaning                                                             |
| ---------------- | ------------------------------------------------------------------- |
| `observed`       | A valid snapshot no older than two minutes was read.                |
| `stale`          | The snapshot is older than two minutes; it carries nothing over.    |
| `unavailable`    | No valid snapshot was readable; it carries nothing over.            |
| `not_applicable` | No service existed (first install); complete readiness is required. |

A failed baseline read never blocks the operation. It only removes the carry-over allowance.

### Component judgment

Readiness judges six components: `sync`, `workstreamReplication`, `workspaceCoordination`, `remoteControl`, `conversation`, and `supervision`. An absent `conversation` or `supervision` counts as `disabled`. A component is accepted when one of these holds:

- It is healthy under the runtime aggregate rule. `sync` and `workstreamReplication` must be `ready`. `workspaceCoordination`, `remoteControl`, and `conversation` may also be `disabled`. `supervision` may also be `dormant` or `attention`.
- The replacement allows Hub unavailability, the component is one of the four Hub-dependent components, and it reports exactly `hub_unavailable`. This retains ADR-0207's `offline_ready` rule.
- The component is not a delivery component, it is `unavailable`, and the observed baseline had the same status and the same `failureCode`. Such a condition predates the operation, and replacing the runtime cannot resolve it.

`sync` and `workstreamReplication` are delivery components. Their readiness is what a Node deployment exists to prove, so a pre-existing failure there is never carried over. `pending` is never accepted. The process status must be `ready` or `degraded`, never `starting` or `stopping`. A component that newly fails, changes its failure code, or never settles still fails readiness, and the existing compensation runs.

### Observation budget

The three-consecutive-observation rule stays: fresh, monotonic snapshots from one process identity, 500 milliseconds apart. The fixed 60-second window becomes a progress-based one. A first fresh snapshot, or a higher count of accepted components than any earlier fresh snapshot showed, extends the deadline to 60 seconds past that observation. The high-water mark is shared across process identities, so a restart loop cannot extend the window again without new progress. The total is bounded at 600 seconds (1,200 observations).

### Receipt

The `readiness` block of `repository_node_onboarding` and `repository_node_rollback` receipts adds these fields:

| Field               | Type                                                       | Meaning                                                                      |
| ------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `conversation`      | bounded component text                                     | The accepted conversation state, such as `ready` or `disabled`.              |
| `supervision`       | bounded component text                                     | The accepted supervision state, such as `unavailable:<failureCode>`.         |
| `baseline`          | `observed`, `stale`, `unavailable`, or `not_applicable`    | Whether carry-over was possible.                                             |
| `carriedConditions` | list of `{ component, status, failureCode, reasonCodes? }` | Pre-existing, unchanged, non-delivery conditions accepted from the baseline. |

`workspaceCoordination` and `remoteControl` may now report `unavailable:<failureCode>` when that condition is carried. `status` keeps its meaning: `ready` means the delivery components are ready, and `offline_ready` means an allowed Hub outage. A carried condition stays visible in the receipt; it is not evidence that the component works.

Organization rollout and rollback consume the same receipt. A first organization admission has no baseline, so it still requires complete readiness.

### Failure detail

`NodeFleetApplyError` now carries bounded, secret-free `details`, and JSON command output includes them in the error envelope:

| Field                 | Meaning                                                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `readiness`           | `{ baseline, blockers: [{ component, observed, baseline }], lastStatus, lastProcessId, observations }` from the last fresh observation before the timeout. |
| `failedCode`          | The code of the failure that started compensation.                                                                                                         |
| `recovery`            | `restored` when compensation succeeded, or `failed` when it could not be proved.                                                                           |
| `recoveryFailureCode` | The typed code of the compensation failure, or `node_fleet_apply_failed` when it had none.                                                                 |

The timeout message names every blocking component, its observed state, and its baseline state. An example is `supervision=unavailable:supervision_attention_required (baseline ready)`. With no fresh snapshot, the message names the elapsed window instead. `node_fleet_recovery_failed` keeps its [ADR-0235](../security/0235-predecessor-bound-node-rollout-rollback.md) meaning. Its message now includes the original failure code and message, and its details keep the original readiness blockers. `lervo repository node apply` prints the bounded message after the code.

### Upgrade planning

A registered exact deployment is `current` with reason `exact_runtime_deployed_runtime_attention` under these conditions:

- Its service is operational and its aggregate is `degraded`.
- Its delivery components are `ready` or `hub_unavailable`.
- Every other component is `ready`, `disabled`, or a settled `unavailable`, `dormant`, or `attention` state, and at least one is `unavailable`.

Fleet status continues to report `degraded` with `inspect_runtime_failure`; the upgrade does not hide the condition.

## Privacy and failure meaning

Receipts and failure details contain only component names, bounded status codes, bounded `reasonCodes`, process IDs, and counts. They exclude paths, configs, service bodies, credentials, prompts, and provider output. A carried condition proves only that it predates the operation and did not change. It does not prove that the component works or that the owner decision was made.

## Verification

Focused CLI tests cover the following:

- Carry-over of identical supervision attention, with the condition reported in `carriedConditions`.
- Rejection of a newly failing component, a changed failure code, a delivery-component failure, and any carry-over without an observed baseline.
- Budget extension across slow startup progress, and failure 60 seconds after the last progress.
- Timeout details that name the blocking component and baseline.
- Recovery failure that keeps the original readiness blockers, and recovery success marked `restored`.
- The upgrade-planning predicate for auxiliary-only conditions.

Installed verification must show `lervo upgrade --apply` in `axli` completing its `repository_node` stage while supervision still reports `preflight_repair_requires_review`, with that condition listed in `carriedConditions`.

## References

- [Transactional repository Node apply and readiness](0207-transactional-repository-node-apply-and-readiness.md)
- [Bounded repository upgrade orchestration](0214-bounded-repository-upgrade-orchestration.md)
- [Bounded offline replacement](../../../specifications/coordination/hub-and-node/runtime-lifecycle/bounded-offline-replacement.md)
