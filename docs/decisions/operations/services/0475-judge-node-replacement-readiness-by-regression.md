# ADR-0475: Judge Node replacement readiness by regression

Status: `accepted`
Decision date: 2026-10-06
Amends: [ADR-0207](0207-transactional-repository-node-apply-and-readiness.md), [ADR-0214](0214-bounded-repository-upgrade-orchestration.md)
Amended by: [ADR-0480](0480-defer-node-cache-warmups-past-readiness.md) (starting heartbeat counts as progress)

## Context

On a WSL host with CLI 0.20.0, `lervo upgrade --apply` in `axli` failed its `repository_node` stage with `node_fleet_readiness_timeout`. The replacement Node service was active: `sync`, `workstreamReplication`, and `remoteControl` were ready; `workspaceCoordination` was disabled. The aggregate was `degraded` solely because `supervision` reported `unavailable/supervision_attention_required` with `preflight_repair_requires_review`, an owner decision predating the upgrade.

ADR-0207 required aggregate `ready`, or `degraded` caused only by `hub_unavailable`, so unrelated pending owner decisions blocked every replacement. The first attempt reported `node_fleet_recovery_failed` but lost the readiness failure that triggered recovery. The fixed 60-second window was also tight: this Node took about 40 seconds to start synchronization.

Even after successful replacement, the upgrade planner would have classified the exact deployed runtime as `blocked/node_runtime_inspect_runtime_failure` because of the same attention.

## Decision

### Regression baseline

Before replacing an installed Node service, apply reads the predecessor's health snapshot. Rollback similarly reads the failed target's snapshot.

| Baseline status  | Meaning                                                                       |
| ---------------- | ----------------------------------------------------------------------------- |
| `observed`       | A valid snapshot that still describes the running predecessor was read.       |
| `stale`          | The snapshot no longer describes a running predecessor; nothing carries over. |
| `unavailable`    | No valid snapshot was readable; nothing carries over.                         |
| `not_applicable` | No service existed (first install); complete readiness is required.           |

A failed baseline read never blocks the operation; it removes only the carry-over allowance.

A `starting` or `stopping` snapshot is refreshed by a live process, so it describes the predecessor while it is no older than two minutes. A settled Node, `ready` or `degraded`, writes its snapshot only when a component changes, so its age says nothing: it describes the predecessor as long as that snapshot's process still runs: its pid is alive and that process started no later than the snapshot's `startedAt`, at most ten minutes earlier. A reused pid belongs to a process started after the writer ended, and an unprovable start time does not count. Before this, every long-running degraded predecessor read as `stale`, so its own evaluated condition could never be carried.

### A baseline without evidence

A predecessor component that never evaluated (`pending`), or a predecessor that left no usable snapshot, gives no evidence about the condition a replacement then settles. Treating that first honest evaluation as a regression rolls back a release that is not at fault, and the restored predecessor reaches the same state. When a readiness timeout's every blocker is such a component, outside the delivery components, and was settled by the replacement, the Node stage judges it by the restored predecessor. It observes the predecessor with the readiness budget until those components settle in three consecutive settled (`ready` or `degraded`) snapshots of a process other than the replacement; a `starting` snapshot may still change. Only when the predecessor settles each of them exactly as the replacement did does the condition predate the release; the stage then replaces the predecessor once more, and readiness carries the condition from that observed baseline. The receipt lists it in `witnessedConditions`. Any other outcome keeps the original failure: a predecessor that settles differently, or not at all, proves a regression or proves nothing. A blocker with an evaluated baseline, a delivery component, an unsettled component, and an unrestored recovery are never witnessed.

### Component judgment

Readiness judges `sync`, `workstreamReplication`, `workspaceCoordination`, `remoteControl`, `conversation`, and `supervision`. Absent `conversation` or `supervision` counts as `disabled`. A component is accepted if any of these conditions holds:

- It is healthy under the runtime aggregate rule: `sync` and `workstreamReplication` must be `ready`; `workspaceCoordination`, `remoteControl`, and `conversation` may also be `disabled`; `supervision` may also be `dormant` or `attention`.
- The replacement allows Hub unavailability, the component is one of the four Hub-dependent components, and it reports exactly `hub_unavailable`. This preserves ADR-0207's `offline_ready` rule.
- It is a non-delivery component reporting `unavailable`, and the observed baseline had the same status and `failureCode`. This condition predates the operation and cannot be resolved by replacing the runtime.

`sync` and `workstreamReplication` are delivery components: proving their readiness is the purpose of Node deployment, so their pre-existing failures never carry over. `pending` is never accepted. Process status must be `ready` or `degraded`, never `starting` or `stopping`. A newly failing component, a changed failure code, or a component that never settles still fails readiness and triggers existing compensation.

### Observation budget

Readiness still requires three consecutive fresh, monotonic snapshots from one process identity, observed 500 milliseconds apart. A snapshot is fresh when it was written after the apply began, except when the service definition was unchanged and the manager did not restart the Node: then the running process's own snapshot counts, since a settled Node writes only on change and no newer snapshot would come. A release whose Node runtime bytes are identical to the running ones, such as v0.45.2, otherwise timed out on every apply and was rolled back. The fixed 60-second window becomes progress-based: the first fresh snapshot, or an accepted-component count higher than any previous fresh snapshot, extends the deadline to 60 seconds after that observation. The high-water mark spans process identities, so a restart loop cannot extend the window without new progress. The total remains bounded at 600 seconds (1,200 observations).

### Receipt

The `readiness` block in `repository_node_onboarding` and `repository_node_rollback` receipts adds:

| Field               | Type                                                       | Meaning                                                                      |
| ------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `conversation`      | bounded component text                                     | Accepted conversation state, such as `ready` or `disabled`.                  |
| `supervision`       | bounded component text                                     | Accepted supervision state, such as `unavailable:<failureCode>`.             |
| `baseline`          | `observed`, `stale`, `unavailable`, or `not_applicable`    | Whether carry-over was possible.                                             |
| `carriedConditions` | list of `{ component, status, failureCode, reasonCodes? }` | Pre-existing, unchanged, non-delivery conditions accepted from the baseline. |

`workspaceCoordination` and `remoteControl` may report `unavailable:<failureCode>` for carried conditions. `status` retains its meaning: `ready` means delivery components are ready; `offline_ready` means an allowed Hub outage. Carried conditions remain visible and do not prove that a component works.

Organization rollout and rollback consume the same receipt. First organization admission has no baseline and still requires complete readiness.

### Failure detail

`NodeFleetApplyError` carries bounded, secret-free `details`, included in the JSON command error envelope:

| Field                 | Meaning                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `readiness`           | `{ baseline, blockers: [{ component, observed, baseline }], lastStatus, lastProcessId, observations }` from the last fresh observation before timeout. |
| `failedCode`          | Code of the failure that triggered compensation.                                                                                                       |
| `recovery`            | `restored` if compensation succeeded; `failed` if it could not be proved.                                                                              |
| `recoveryFailureCode` | Typed compensation failure code, or `node_fleet_apply_failed` if none existed.                                                                         |

The timeout message names every blocking component, its observed state, and its baseline state; for example, `supervision=unavailable:supervision_attention_required (baseline ready)`. Without a fresh snapshot, it names the elapsed window instead.

`node_fleet_recovery_failed` retains its [ADR-0235](../security/0235-predecessor-bound-node-rollout-rollback.md) meaning. Its message includes the original failure code and message; its details retain the original readiness blockers. `lervo repository node apply` prints the bounded message after the code.

### Upgrade planning

A registered exact deployment is `current` with reason `exact_runtime_deployed_runtime_attention` when all of these hold:

- Its service is operational and its aggregate is `degraded`.
- Its delivery components are `ready` or `hub_unavailable`.
- Every other component is `ready`, `disabled`, or in a settled `unavailable`, `dormant`, or `attention` state, with at least one `unavailable`.

Fleet status still reports `degraded` with `inspect_runtime_failure`; upgrading does not hide the condition.

## Privacy and failure meaning

Receipts and failure details contain only component names, bounded status codes, bounded `reasonCodes`, process IDs, and counts. They exclude paths, configs, service bodies, credentials, prompts, and provider output. A carried condition proves only that it predates the operation and is unchanged—not that the component works or the owner decision was made.

## Verification

Focused CLI tests cover:

- Identical supervision attention carried over and reported in `carriedConditions`.
- Rejection of a newly failing component, a changed failure code, a delivery-component failure, and carry-over without an observed baseline.
- Budget extension during slow startup progress, and failure 60 seconds after the last progress.
- Timeout details naming the blocking component and baseline.
- Recovery failure retaining original readiness blockers, and recovery success marked `restored`.
- The upgrade-planning predicate for auxiliary-only conditions.
- A settled predecessor that is hours old but running observed, one whose process is gone or whose pid was reused stale, and an old `starting` snapshot stale (`node-fleet-readiness.test.ts`).
- Eligibility for a witness, the witness ignoring the failed replacement and states read while starting, a predecessor that never settles, a second replacement after an identical settlement, the original failure after a different one, and no witness for an evaluated baseline (`node-fleet-readiness-witness.test.ts`).

Installed verification must show `lervo upgrade --apply` in `axli` completing `repository_node` while supervision still reports `preflight_repair_requires_review`, listed in `carriedConditions`.

## References

- [Transactional repository Node apply and readiness](0207-transactional-repository-node-apply-and-readiness.md)
- [Bounded repository upgrade orchestration](0214-bounded-repository-upgrade-orchestration.md)
- [Bounded offline replacement](../../../specifications/coordination/hub-and-node/runtime-lifecycle/bounded-offline-replacement.md)
