# Supervised assignment completion

A successful worker run remains separate from completion and owner acceptance. The native owner can propose `prepare_completion` only for the exact returned leased assignment. Its reasoning context includes the repository's versioned English writing contract and actual result text. The independently admitted model turn evaluates every required semantic writing check; deterministic checks still use the existing writing gate. Missing, failed, malformed, or mismatched model findings cannot produce a publication permit.

## Completion evidence and control

Model output contains `assignmentId`, `resultContentHash`, `writingPolicyId`, and explicit `checks` with `checkId`, `status`, and `violationCount`. The generated evaluation retains an evaluator identity derived from the actual native result. The completion adapter rereads the admitted reasoning plan, settled native run, exact output, policy, evaluation, permit, result bytes, responsibility, and verification. A supplied `allowed` status without this evidence grants no completion authority.

`work.assignment_completion.v1` is a separate admitted owner control. Its version-1 artifact contains `schemaVersion`, `kind: work.assignment_completion`, `responsibility`, `expectedAssignmentHash`, `writingArtifactHash`, `reasoningPlanHash`, `reasoningResultHash`, `preparedAt`, and `rationaleArtifactHash`. It starts no provider; the model's prior token usage remains independently accounted for.

## Preparation, reconciliation, and acceptance

The adapter records the existing envelope-version-3 `assignment.completion.prepared` event only under the exact live lease, current owner fence, passed run verification, and independent writing permit. It then uses the existing assignment reconciliation transition: leased becomes completed, the lease is cleared, and the exact result artifact is recorded. The `assignment.completion.reconciled` event commits through the owner fence; failed event recording restores assignment bytes. Both existing events retain their privacy contracts and contain no result text, semantic findings, paths, or credentials.

Preparation is not task acceptance. The next owner model decision must independently review the reconciled result against every acceptance criterion and required verification before the existing artifact-review effect can accept it. Goal completion requires every task to be accepted. User-facing goal delivery retains separate contextual writing and transport contracts.

## Recovery and validation

After a crash following preparation, the owner can reconcile the exact recorded evidence without rerunning the model or worker. It revalidates the current mandate, original reasoning context, unchanged assignment, and all preparation coordinates. The original lease may have expired only if preparation occurred within its valid interval and the mandate and completion deadline still permit reconciliation. Changed or inconsistent evidence remains uncertain.

The concrete native-protocol integration exercises real worker dispatch, independent native semantic judgement, exact completion reconciliation, owner artifact acceptance, and goal completion. Model verdicts are controlled fixture outputs, not evidence of external-model quality or installed acceptance. Tests also cover event-write failure with assignment rollback, restart after native decisions, and failed semantic checks that leave the assignment leased.
