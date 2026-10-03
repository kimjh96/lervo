# Canonical events

Version 4 adds three events using the existing canonical envelope. Required nullable fields must appear as `null`; never omit them.

## `repository.knowledge.baseline.requested`

Required payload: `obligationId`, `sourceSnapshotId`, `sourceSnapshotHash`, `policyHash`, `debtDigest`, `delegationHash`, four-kind `debtCounts`, `inputArtifactHash`, `requestedAt`.

Records an exact captured baseline and atomic queued obligation. Grants no semantic approval.

## `repository.knowledge.stage.recorded`

Required payload: `obligationId`, `predecessorEventId`, `predecessorEventHash`, `stage`, `state`, `snapshotHash`, `assignmentId`, `leaseGeneration`, `attemptCount`, `inputArtifactHash`, `resultArtifactHash`, `nextObligationId`, `dependencyHash`, `failureCode`, `occurredAt`.

Records a durable bounded outcome and continuation. Stopped dependencies require their exact hash.

## `repository.knowledge.convergence.recorded`

Required payload: `obligationId`, `originalEventId`, `originalEventHash`, `scope`, `terminalState`, `snapshotHash`, `canonicalDispositionDigest`, `normalizationCoverageDigest`, `lifecycleReceiptDigest`, `knowledgeSnapshotHash`, `successorId`, `failureCode`, `resolvedAt`.

Records verified `current` or explicit `superseded` with a successor. Neither rewrites historical resolution.

## Assignment provenance

`assignment.created` gains an all-or-none provenance set: `convergenceContractVersion`, `convergenceObligationId`, `convergenceBaselineEventId`, `convergenceBaselineEventHash`, `convergenceStage`, `convergenceInputArtifactHash`, `convergenceDelegationHash`, and `convergenceAgentId`.
