# Recovery events and regression acceptance

## Event and privacy contract

`assignment.reopened` uses event envelope version 3 and requires payload fields `assignmentId`, `assignmentRevision`, `assignmentHash`, `kind`, `predecessorAssignmentHash`, `responsibilityHash`, `sourceRunId`, `terminalEventId`, `reviewEventId`, `attemptNumber` and `predecessorLeaseGeneration`.

`kind` is `rework` or `retry`: rework requires a review event; retry uses a null review coordinate. Prose, paths, source bodies, model output and credentials are excluded. The effect plan and rationale stay in CAS.

An absent receipt with unchanged predecessor bytes is not started. A conflicting revision or partial receipt remains uncertain. A matching event proves only that the exact assignment was reopened. A fresh lease, workspace, provider start and accepted successor result each require their own evidence.

## Regression coverage and acceptance boundaries

The workforce regression suite covers state restoration, duplicate or stale recovery rejection, prior-artifact preservation and generation continuity through the next claim.

The native-adapter fixture completes rejected work through reopening, a successor claim, a second workspace, retry execution, independent writing judgement, accepted review and goal completion. It observes eight calls and four hundred reported tokens, including recovery after reopening-event failure and runtime restart without duplicate invocation. Model replies are controlled fixture outputs; external-model quality and installed acceptance remain separate requirements.

The returned-lease regression rejects absent or substituted lease coordinates and restores the exact leased revision after receipt failure. Independent writing rejection records rework without preparing successful completion.
