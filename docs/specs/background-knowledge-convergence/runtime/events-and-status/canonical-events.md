# Canonical events

Version 4 adds three events using the existing canonical envelope. Required nullable fields must appear as `null`, never be omitted.

## `repository.knowledge.baseline.requested`

Required payload: `obligationId`, `sourceSnapshotId`, `sourceSnapshotHash`, `policyHash`, `debtDigest`, `delegationHash`, four-kind `debtCounts`, `inputArtifactHash`, `requestedAt`.

Records an exact captured baseline and atomic queued obligation. Grants no semantic approval.

## `repository.knowledge.stage.recorded`

Required payload: `obligationId`, `predecessorEventId`, `predecessorEventHash`, `stage`, `state`, `snapshotHash`, `assignmentId`, `leaseGeneration`, `attemptCount`, `inputArtifactHash`, `resultArtifactHash`, `nextObligationId`, `dependencyHash`, `failureCode`, `occurredAt`.

Records a durable bounded outcome and continuation. Stopped dependencies require their exact hash.

## `repository.knowledge.convergence.recorded`

Required payload: `obligationId`, `originalEventId`, `originalEventHash`, `scope`, `terminalState`, `snapshotHash`, `canonicalDispositionDigest`, `normalizationCoverageDigest`, `lifecycleReceiptDigest`, `knowledgeSnapshotHash`, `successorId`, `failureCode`, `resolvedAt`.

Records verified `current` or explicit `superseded` with a successor. Neither rewrites historical resolution.

## `knowledge.convergence.owner.changed`

Required payload: `repositoryIdentityHash`, `holderHostHash`, `previousHolderHostHash`, `observerHostHash`, `generation`, `mode`, `reason`, `occurredAt`.

Records a change in the observing host's observed convergence owner or the end of its own holding, in that host's own store ([ADR-0466](../../../../decisions/coordination/sync/0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md)). Hosts appear only as hashes. The private ownership fence grants commit authority; the event does not.

## `knowledge.convergence.delegation.continued`

Required payload: `repositoryIdentityHash`, `action` (`renewed | seeded | rebound | adopted`), `source` (`renewal | peer | policy_template | binding_refresh | owner`), `policyHash`, `previousPlanHash`, `planHash`, `scopeHash`, `expiresAt`, `observerHostHash`, `sourceHostHash`, `occurredAt`.

Records a delegation the resident renewed or seeded under the host continuity policy ([ADR-0469](../../../../decisions/coordination/sync/0469-keep-background-knowledge-continuous-on-every-host.md)). The event ID derives from `planHash`. Hashes and the expiry only; the applied delegation, not the event, grants authority. [ADR-0471](../../../../decisions/coordination/sync/0471-keep-cross-host-knowledge-ownership-safe-when-hub-coordination-fails.md) adds `rebound` with source `binding_refresh`: an identity-preserving rebind of drifted suite or role hashes. Readers must deploy before writers that emit it. [ADR-0478](../../../../decisions/coordination/sync/0478-renew-each-delegation-with-one-writer.md) adds `adopted` with source `owner`: a host that does not own the repository adopted the owner's term from the owner's host record, and `sourceHostHash` names the owner. Readers must deploy before writers that emit it.

## `knowledge.convergence.definitions.installed`

Required payload: `repositoryIdentityHash`, `scopeHash`, `observerHostHash`, `sourceHostHash`, `definitions` (1 to 32 entries of `kind`, `bindingHash`, `contentHash`, and `action`: `created | replaced`), `occurredAt`.

Records the delegation-bound suites, repository roles, or asset manifest a host installed before it seeded a peer's scope ([ADR-0477](../../../../decisions/coordination/sync/0477-carry-delegation-bound-definitions-across-hosts.md)). The event ID derives from `scopeHash` and the entries. It carries hashes and closed codes only, never suite IDs, role IDs, paths, commands, or content. The installed files and their materialization receipt are canonical; losing the event loses only the audit line. Readers must deploy before writers that emit it.

## `knowledge.publication.repaired`

Required payload: `repairCommit`, `repairedCommits` (1 to 64), `toolGeneratedPathCount`, `outsideScopePathCount`, `normalizationPathCount`, `pathSetHash`, `hostHash`, `occurredAt`.

Records one corrective `Lervo Knowledge` commit. The commit restored tool-generated documents or out-of-scope paths that earlier knowledge commits changed ([ADR-0473](../../../../decisions/knowledge/documents/0473-publish-knowledge-within-its-write-scope-and-never-rewrite-a-tool-generated-document.md)). The event ID derives from `repairCommit`. It carries commit coordinates, counts, and one digest, never paths or content. The commit and its `Lervo-Publication-Repair` trailers remain canonical; losing the event loses only the audit line.

## `knowledge.integration_target.absorbed`

Required payload: `previousTarget`, `mergeBase`, `newTarget`, `absorbedPathCount`, `droppedPathCount`, `pathSetHash`, `occurredAt`.

Records that a squash merge absorbed the knowledge integration ref, so the owner moved the Lervo-only ref to `HEAD` after keeping the old tip under `refs/lervo/knowledge-integration-absorbed/` ([ADR-0482](../../../../decisions/knowledge/semantics/0482-absorb-squash-merged-semantic-candidates-and-type-verification-source-changes.md)). The event ID derives from the old tip and the new target. It carries commit coordinates, counts, and one digest, never paths or content. The backup ref remains canonical; losing the event loses only the audit line.

## Assignment provenance

`assignment.created` gains an all-or-none provenance set: `convergenceContractVersion`, `convergenceObligationId`, `convergenceBaselineEventId`, `convergenceBaselineEventHash`, `convergenceStage`, `convergenceInputArtifactHash`, `convergenceDelegationHash`, and `convergenceAgentId`.
