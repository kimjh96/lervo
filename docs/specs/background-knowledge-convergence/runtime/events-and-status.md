# Events, status, and privacy

## Canonical events

Version 4 adds three events using the existing canonical envelope. Required nullable fields must appear as `null`, not be omitted.

### `repository.knowledge.baseline.requested`

Required payload: `obligationId`, `sourceSnapshotId`, `sourceSnapshotHash`, `policyHash`, `debtDigest`, `delegationHash`, four-kind `debtCounts`, `inputArtifactHash`, `requestedAt`.

Records an exact captured baseline and atomic queued obligation; grants no semantic approval.

### `repository.knowledge.stage.recorded`

Required payload: `obligationId`, `predecessorEventId`, `predecessorEventHash`, `stage`, `state`, `snapshotHash`, `assignmentId`, `leaseGeneration`, `attemptCount`, `inputArtifactHash`, `resultArtifactHash`, `nextObligationId`, `dependencyHash`, `failureCode`, `occurredAt`.

Records a durable bounded outcome and continuation. Stopped dependencies require their exact hash.

### `repository.knowledge.convergence.recorded`

Required payload: `obligationId`, `originalEventId`, `originalEventHash`, `scope`, `terminalState`, `snapshotHash`, `canonicalDispositionDigest`, `normalizationCoverageDigest`, `lifecycleReceiptDigest`, `knowledgeSnapshotHash`, `successorId`, `failureCode`, `resolvedAt`.

Records verified `current` or explicit `superseded` with a successor. Neither rewrites historical resolution.

### Assignment provenance

`assignment.created` gains an all-or-none provenance set: `convergenceContractVersion`, `convergenceObligationId`, `convergenceBaselineEventId`, `convergenceBaselineEventHash`, `convergenceStage`, `convergenceInputArtifactHash`, `convergenceDelegationHash`, and `convergenceAgentId`.

## States

| State | Meaning |
| --- | --- |
| `queued` / `running` | Durable work awaits admission or holds the exact current lease. |
| `waiting_review` / `waiting_authority` | An exact review or authority dependency blocks progress; live path conflicts preserve user work. |
| `retry_scheduled` | A bounded retry has an explicit schedule. |
| `stale` | Source or context changed; old evidence cannot authorize completion. |
| `recovery_required` | A journal or uncertain host effect must be reconciled before new writes. |
| `attention_required` | A deterministic source, semantic, policy, usage, capacity, or budget condition requires a changed dependency. |
| `current` / `superseded` | Exact scope completed or was explicitly replaced by a newer obligation. |

## Privacy and retention

Public events expose bounded IDs, hashes, counts, timestamps, and normalized codes. Source paths/bodies, prompts, candidate prose, reviewer rationale, absolute paths, credentials, and native errors remain in owner-only private CAS or private projections.

Scheduling rows retain at most 1,024 acknowledged entries or seven days. Pruning never deletes canonical events or referenced CAS proof. Current replay projections retain active obligations and the last verified currency.

## Source gate failures

The source gate adds no canonical event.

- `knowledge_materialization_busy`: an active managed reader or another writer prevented exclusive admission. This is a bounded `retry_scheduled` failure with no source mutation.
- `knowledge_source_gate_invalid`: the private lock file or transaction could not be trusted; requires `attention_required`.

Public records contain only the normalized code. Native SQLite errors, physical paths, and source bytes remain private. A managed run reports its existing `repository_snapshot_failed` when source admission is busy or invalid.

## Status and inspection

Status separates `transport`, four-kind `debtCounts`, `outstanding`, `oldestAgeMilliseconds`, `activeStage`, `state`, `reason`, `lastVerifiedCurrency`, `baselineCurrent`, and `worker`.

Debt counts are `null` when an interrupted journal prevents a stable scan. Historical verified currency remains visible but cannot establish present currency. Worker health is independently `healthy`, `degraded`, or `not_running`, with state, heartbeat, and reason. A private bounded heartbeat projection updates every 15 seconds, expires after 120 seconds, verifies process liveness, and retains at most 64 residents. Queue emptiness, heartbeat, and zero lint errors alone never establish `baselineCurrent`.

CLI inspection failure exits with status 1 and only a bounded normalized error code. It emits no successful status or currency claim, private source path, native message, or stack. Untyped failure is `knowledge_inspection_failed`; typed source-kind and capture-capacity stops remain distinguishable. Storage closes after an opened inspection fails. This diagnostic boundary adds no event or writer authority.

## Provider pauses and probes

Quota/authentication pauses use native normalized observations. An unknown reset remains paused until an explicitly requested, capability-free native probe produces matching structured proof and observed usage:

```bash
lervo knowledge convergence provider-probe --provider codex --json
```

The probe shares host admission and current delegation. It cannot erase a newer pause, infer recovery from elapsed time, or automatically retry an unknown reset. Private evidence stores the native observation; public status contains its hash and normalized reason.
