# Assignment recovery and successor execution

Recovery preserves assignment identity and the original acceptance, verification and path ceiling. The native owner proposes bounded rework; canonical admission checks actual current review and completion evidence before reopening.

`SupervisedAssignmentRecoveryV1` contains `schemaVersion`, `kind`, `responsibility`, `recovery`, `provider` and `rationaleArtifactHash`. Its nested recovery coordinate binds the predecessor assignment artifact, prior responsibility hash, terminal run and event, rejected review event, next attempt ordinal and prior lease generation. Its successor responsibility addresses the rejection and binds the revision after a separate claim.

A returned result rejected by independent writing judgement can still have a leased assignment. Rejected writing must not be recorded as successful completion. `SupervisedAssignmentRecoveryV2` adds the exact `settledLeaseId` to the six V1 fields and supports rework or a separately proven safe retry. Admission requires:

- The matching current leased revision and generation.
- A reconciled completed run with the exact recorded rejection, or the safe-failure proof.
- A workspace with no registered writer.

Reopening clears that settled lease. Expiry, a stopped process or a bare rejection event is insufficient evidence.

## Durable transition

`reopenAssignment` changes an exact completed assignment to queued for rework, or an exact failed assignment to queued for a separately evidenced retry. It preserves previous result references, assignee and failure evidence, increments the assignment revision and retains one current recovery coordinate. Earlier records remain in canonical events and CAS rather than accumulating in the assignment record.

`lastLeaseGeneration` preserves the greatest acquired generation after completion clears the live lease. A successor claim increments it and receives a distinct lease and session. Old records without an observed generation remain readable but cannot be reopened by guessing their former lease. Reopening does not claim a lease, start a provider, accept an artifact or complete a goal.

The scheduler lock protects the exact predecessor compare-and-swap and dependent-work check. If dependent work consumed the completed result, reopening is blocked until that work is reconciled. Failed event recording restores predecessor bytes. Before recording success, the Node rechecks workstream, roster, assignment, workspace, event head, mandate, deadline and owner fence.

Built-in Node recovery admits rejected, reconciled completion and narrowly evidenced no-tool provider failures. Failed runs require their original canonical diagnostic ledger, one actual read-only session attesting unsupported tool calls, commands and file changes, one consistent stop before one failed terminal, and no effect events. Only turn, stream, result-collection or result-storage failures qualify. Cancellation, stop, contract, snapshot and telemetry failures remain uncertain. This proof does not cover an ordinary native tool-capable session. Missing usage still blocks token admission.

An explicitly invoked Node repair can also settle an interrupted managed run whose canonical run history is exactly `managed.execution.reserved`, `work.causality.recorded`, `run.requested`, `run.resolved`, and `role.input.bound`, with no adapter start or later run event. The repair verifies the original admitted decision, exact execution key, current owner lease and eligible mandate. A local Linux journal boot inventory must place every prefix event in one completed boot, show its successor, and match the current kernel boot ID. The writer stores an exact, hash-pinned diagnostic in CAS and appends one owner-fenced `run.failed` with `failureCode: interrupted_before_turn`, `retryable: true`, and the diagnostic digest. Its event head, run prefix and boot ID are rechecked at commit. A missing or malformed diagnostic, unexpected event, overlapping boot, stale authority or late worker remains uncertain.

The terminal means the old process cannot start a turn after the reboot; it does not claim provider-reported usage. Admission excludes this **proven pre-turn run only** from the population requiring provider usage, while retaining its reservation, events and assignment history. Other started or partial runs still require their exact usage receipts. A separate `SupervisedAssignmentRecoveryV2` decision must reopen the expired leased assignment; this repair alone neither starts a retry nor accepts a result.

## Workspace and attempt lineage

After confirmed recovery, the native owner acquires the exact successor responsibility under its existing mandate. Earlier ready or paused workspace generations with no registered writer are retained. The next lease prepares a distinct checkout under the trusted parent, base and integration target. An active, partially provisioned or recovery-marked predecessor blocks automatic continuation. Retaining a checkout neither proves global process quiescence nor authorizes removal, discard or integration.

`SupervisedManagedExecutionV2` carries the exact recovery coordinate and existing work ID. The managed CLI receives ordinary retry causality: the prior run is both parent and retry source, and the attempt ordinal increments. V1 remains the initial-attempt contract. Worker admission rejects omitted or substituted recovery coordinates.

Previous result text and the canonical review rationale provide evidence for the revised task but grant no authority. Both owner and successor worker receive the exact recorded rejection. Worker instructions include the versioned result writing contract and explain that pinned verification runs in the control repository after result collection. Missing configuration in the isolated checkout does not prove verification is unavailable.

Task observation considers only requested runs after the current responsibility binding. A preceding terminal event cannot complete a newly claimed responsibility. Owner review, writing checks, assignment completion and goal acceptance are repeated against the new attempt's actual evidence. A successor attempt must pass fresh verification, writing judgement and owner acceptance before goal completion.

## Event and privacy contract

`assignment.reopened` uses event envelope version 3 and requires payload fields `assignmentId`, `assignmentRevision`, `assignmentHash`, `kind`, `predecessorAssignmentHash`, `responsibilityHash`, `sourceRunId`, `terminalEventId`, `reviewEventId`, `attemptNumber` and `predecessorLeaseGeneration`. `kind` is `rework` or `retry`: rework requires a review event; retry uses a null review coordinate. Prose, paths, source bodies, model output and credentials are excluded. The effect plan and rationale stay in CAS.

An absent receipt with unchanged predecessor bytes is not started. A conflicting revision or partial receipt remains uncertain. A matching event proves only that the exact assignment was reopened. A fresh lease, workspace, provider start and accepted successor result each require their own evidence.

## Regression coverage and acceptance boundaries

The workforce regression suite covers state restoration, duplicate or stale recovery rejection, prior-artifact preservation and generation continuity through the next claim.

The native-adapter fixture completes rejected work through reopening, a successor claim, a second workspace, retry execution, independent writing judgement, accepted review and goal completion. It observes eight calls and four hundred reported tokens, including recovery after reopening-event failure and runtime restart without duplicate invocation. Model replies are controlled fixture outputs; external-model quality and installed acceptance remain separate requirements.

The returned-lease regression rejects absent or substituted lease coordinates and restores the exact leased revision after receipt failure. Independent writing rejection records rework without preparing successful completion.
