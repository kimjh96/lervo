# States and status inspection

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

## Source gate failures

The source gate adds no canonical event.

- `knowledge_materialization_busy`: an active managed reader or another writer prevented exclusive admission. This bounded `retry_scheduled` failure causes no source mutation.
- `knowledge_source_gate_invalid`: the private lock file or transaction could not be trusted; requires `attention_required`.

Public records contain only the normalized code. Native SQLite errors, physical paths, and source bytes remain private. A managed run reports its existing `repository_snapshot_failed` when source admission is busy or invalid.

## Status and inspection

Status separates `transport`, four-kind `debtCounts`, `outstanding`, `oldestAgeMilliseconds`, `activeStage`, `state`, `reason`, `lastVerifiedCurrency`, `baselineCurrent`, and `worker`.

A `retry_scheduled` status also carries `retry` with `attemptCount`, `attemptLimit`, and `nextAttemptAt`. Typed transient failures have a limit of 16 attempts. A stage failure without a typed convergence code, such as a numeric process exit status, is `knowledge_stage_failure_unclassified` with a limit of 4. Its last attempt records `attention_required` with private failure evidence and a reevaluation time six hours later ([ADR-0472](../../../../decisions/knowledge/documents/0472-start-absent-integration-refs-and-bound-untyped-stage-failures.md)).

A `knowledge_normalization_outside_delegation` status also carries `scopeGap` with `pendingDocuments` and `outsideNormalizationRoots`, read from the stage's exact private dependency. These are repository-relative directory or root-file names, never document bodies ([ADR-0474](../../../../decisions/knowledge/documents/0474-name-normalization-documents-outside-the-delegation.md)).

A `knowledge_sources_parked` status also carries `parked` with `count` and `sources`, read from the stage's exact private dependency. Each source has `stage` (`canonical` or `normalization`), its repository-relative `path`, `reason` (`review_rejected` or `owner_decision`), and `attempts`. The status never shows reviewer text or document bytes. Every other stage of the obligation has finished. Editing a parked source readmits it ([ADR-0479](../../../../decisions/knowledge/semantics/0479-park-rejected-semantic-candidates-and-settle-opaque-assets-by-the-delegation-suite.md)).

A `knowledge_verification_modified_sources` status also carries `verificationChanges` with `changedPathCount` and up to 256 repository-relative `paths`. A pinned verification suite changed these paths while it ran, as shown by the diff of its before and after snapshots. The status never shows file contents ([ADR-0482](../../../../decisions/knowledge/semantics/0482-absorb-squash-merged-semantic-candidates-and-type-verification-source-changes.md)).

Each settled dependency records the evaluation contract that settled it, `adr-0483:<digest of the runtime's evaluation module>`. A stall settled under any other contract is requeued once by the new runtime and settles again under its contract. Uncertain-effect and recovery dependencies keep their own inspection. A `knowledge_sources_parked` status may list `stage: "lifecycle"` entries naming a parked plan kind ([ADR-0483](../../../../decisions/knowledge/semantics/0483-reevaluate-settled-semantic-candidates-once-per-evaluation-contract.md)).

Debt counts are `null` when an interrupted journal prevents a stable scan. This `recovery_required` status also carries `recoveryCommand: "lervo knowledge materialize --recover"`, the one owner command that resolves the journal. A journal whose owner process is still running is not interrupted: the resident cycle reports `busy`, and a stage records `knowledge_materialization_busy` as `retry_scheduled` ([ADR-0465](../../../../decisions/knowledge/documents/0465-commit-settled-knowledge-documents-at-batch-boundaries.md)). Historical verified currency remains visible but cannot establish present currency.

Worker health is independently `healthy`, `degraded`, or `not_running`, with state, heartbeat, and reason. A private bounded heartbeat projection updates every 15 seconds, expires after 120 seconds, verifies process liveness, and retains at most 64 residents. Queue emptiness, heartbeat, and zero lint errors alone never establish `baselineCurrent`.

CLI inspection failure exits with status 1 and only a bounded normalized error code. It emits no successful status or currency claim, private source path, native message, or stack. Untyped failure is `knowledge_inspection_failed`; typed source-kind and capture-capacity stops remain distinguishable. Storage closes after an opened inspection fails. This diagnostic boundary adds no event or writer authority.
