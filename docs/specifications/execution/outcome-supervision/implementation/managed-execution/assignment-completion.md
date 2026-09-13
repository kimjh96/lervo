# Supervised assignment completion

A successful worker run remains separate from completion and owner acceptance. The native owner can propose `prepare_completion` only for the exact returned leased assignment. Its reasoning context includes the repository's versioned English writing contract and actual result text. The independently admitted model turn evaluates every required semantic writing check; deterministic checks still use the existing writing gate. Missing, failed, malformed, or mismatched model findings cannot produce a publication permit.

## Completion evidence and control

Model output contains `assignmentId`, `resultContentHash`, `writingPolicyId`, and explicit `checks` with `checkId`, `status`, and `violationCount`. The generated evaluation retains an evaluator identity derived from the actual native result. The completion adapter rereads the admitted reasoning plan, settled native run, exact output, policy, evaluation, permit, result bytes, responsibility, and verification. A supplied `allowed` status without this evidence grants no completion authority.

`work.assignment_completion.v1` is a separate admitted owner control. Its version-1 artifact contains `schemaVersion`, `kind: work.assignment_completion`, `responsibility`, `expectedAssignmentHash`, `writingArtifactHash`, `reasoningPlanHash`, `reasoningResultHash`, `preparedAt`, and `rationaleArtifactHash`. It starts no provider; the model's prior token usage remains independently accounted for.

## Preparation, reconciliation, and acceptance

For version-1 and version-2 controls, the adapter records the existing envelope-version-3 `assignment.completion.prepared` event only under the exact live lease, current owner fence, passed run verification, and independent writing permit. It then uses the existing assignment reconciliation transition: leased becomes completed, the lease is cleared, and the exact result artifact is recorded. The `assignment.completion.reconciled` event commits through the owner fence; failed event recording restores assignment bytes. Both events retain their privacy contracts and contain no result text, semantic findings, paths, or credentials.

Preparation is not task acceptance. The next owner model decision must independently review the reconciled result against every acceptance criterion and required verification before the existing artifact-review effect can accept it. Goal completion requires every task to be accepted. User-facing goal delivery retains separate contextual writing and transport contracts.

## Recovery and validation

After a crash following preparation, the owner can reconcile the exact recorded evidence without rerunning the model or worker. It revalidates the current mandate, original reasoning context, unchanged assignment, and all preparation coordinates. For version-1 and version-2 controls, the original lease may have expired only if preparation occurred within its valid interval and the mandate and completion deadline still permit reconciliation. Changed or inconsistent evidence remains uncertain.

The concrete native-protocol integration exercises real worker dispatch, independent native semantic judgement, exact completion reconciliation, owner artifact acceptance, and goal completion. Model verdicts are controlled fixture outputs, not evidence of external-model quality or installed acceptance. Tests also cover event-write failure with assignment rollback, restart after native decisions, and failed semantic checks that leave the assignment leased.

## Settled execution after lease expiry

`work.assignment_completion.v3` separates an already settled worker execution from the current owner's later completion judgement. It retains the version-1 fields and adds `roleEvaluationArtifactHash` (null when the role requires no research evaluation), `terminalEventId`, `executionCompletedAt`, and `settlementDeadline`. The exact source terminal must be `run.completed`, include the returned artifact and passed verification, and occur within the original lease's half-open interval and before the original responsibility completion deadline. The assignment revision, executor, lease, responsibility, result bytes, and settled resource evidence must remain unchanged. A late worker result, missing terminal, uncertain effects or usage, failed writing or role evaluation, and changed assignment cannot use this control.

The current owner mandate, ancestry, source revision, owner fence, and independently evaluated writing permit authorize preparation. Its separate settlement deadline is later than the actual preparation time, no more than 120 seconds away, and admitted within the current mandate. Neither the original lease nor responsibility deadlines change. Preparation is never backdated, and this effect starts no worker or model. Existing recorded native writing judgement may be reused only through the usual exact-context checks.

The Node invokes a separate trusted workforce settlement entrypoint with the verified terminal time. The state transition checks that execution time against the unchanged original lease and records the actual reconciliation time. Existing generic governed reconciliation still requires preparation inside the original lease; it cannot adopt a late preparation merely by reading the event. Preparation and reconciliation retain their existing event names, required fields, envelope version, and privacy contracts. The version-3 CAS control and its admitted decision bind the additional evidence; timestamps in the events keep their original meanings. Recording failure restores assignment bytes, and restart revalidates the same control before reconciling once.

Native process integration covers late owner judgement, event failure and restart, one retained worker execution, unchanged lease history, independent artifact acceptance, and goal completion. Pure contract and workforce tests reject invalid intervals, changed revisions, and ordinary reconciliation of late preparation. External-provider and installed acceptance remain distinct observations.
