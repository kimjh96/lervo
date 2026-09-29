# Background convergence runtime

Status: `active`
As of: 2026-09-28

## Ownership and activation

`@lervo/repository-knowledge` owns provider-neutral baseline replay, stage handoff, receipts, and settlement. The bundled private `@lervo/repository-knowledge-runtime` composes repository sources, workforce, managed workspaces, integration, normalization, and lifecycle verification. CLI and Node use that same runtime. Provider process behavior remains in `@lervo/repository-knowledge-compiler`.

The standalone Node hosts the version-four resident owner in one owned child of its
same immutable runtime artifact, following [ADR-0441](../../decisions/knowledge/repository/canonicalization/0441-isolate-resident-knowledge-from-node-conversations.md).
Managed conversation repository snapshots use a separate one-shot child of that
artifact under [ADR-0442](../../decisions/knowledge/repository/canonicalization/0442-isolate-conversation-repository-snapshots.md),
retaining the existing snapshot policy and deadline.
Under [ADR-0444](../../decisions/knowledge/repository/canonicalization/0444-serialize-knowledge-materialization-with-managed-runs.md),
a managed provider run holds a shared repository source lease from admission through
settlement. Durable knowledge apply and recovery hold an exclusive lease around the
complete journal and event effect. Concurrent turns may read together; a knowledge
writer waits through bounded retry scheduling if a turn is active. A busy or invalid
managed admission fails the existing repository snapshot stage before provider start.
An interrupted materialization journal blocks new managed reads until recovery.
The resident knowledge child awaits ordinary cleanup on parent shutdown. A snapshot
child stops its read-only capture if its parent disappears. No new
provider or write authority is implied. Library hosts without a runtime entry retain
their existing behavior. Installed child ancestry and real busy Discord acceptance
must be observed independently of source tests.

When an active knowledge materialization transaction makes the knowledge index
return `knowledge_recovery_required`, a managed conversation read records and uses
only its operational repository search attempt. It emits no knowledge attempt,
knowledge recommendation, relation projection, or currency claim for that turn.
Other knowledge-source failures still fail closed. This read fallback does not
settle or recover the background transaction; the owner retains that obligation.

The runtime requires the reviewed event-writer version 4 transition and an exact project delegation. Default writers remain unchanged. Reader support must precede production activation. Without valid delegation, discovery reports `waiting_authority` and invokes no provider or document writer.

Delegation lives at `.lervo/knowledge/convergence-delegation.json`. Its version 1 contract pins project, active parent ancestry, generator/reviewer/writer/integrator role versions and hashes, capabilities, provider choices, canonical and normalization roots, meaningful verification suites, integration ref and repository identity, expiry, resource ceilings, and an existing reviewer's exact plan hash. Optional asset dispositions bind exact path/hash, kind, rationale, and a pinned verification suite. Generated output cannot create these permissions.

The parent and reviewer ancestry is local to the repository host. A source replica between hosts with separate workforce records must not exchange this authority file: project initialization ignores its exact path in `.lervo/.gitignore`, and each host applies its own reviewed grant. This leaves the grant authoritative on that host while preventing a peer's unrelated agent identity or expired grant from replacing it. The asset disposition sidecar and canonical repository documents remain ordinary repository sources.

[ADR-0438](../../decisions/knowledge/repository/canonicalization/0438-bind-bounded-asset-manifests-to-delegation.md) permits optional `assetDispositionManifestHash` binding exact raw UTF-8 bytes of the fixed `.lervo/knowledge/convergence-asset-dispositions.json` sidecar. Its closed version-one contract contains `schemaVersion` and `dispositions`, with the same per-asset fields and suite pins as inline declarations. The sidecar is at most 1 MiB; inline and sidecar declarations together contain at most 1,024 unique safe paths. Inline declarations remain limited to 256 and the delegation to 64 KiB. Runtime authority and synchronous settlement recheck ordinary no-follow bytes. A sidecar alone grants no permission or semantic acceptance.

```bash
lervo knowledge convergence status --json
lervo knowledge convergence inspect --json
lervo knowledge convergence delegation --from reviewed-delegation.json --json
lervo knowledge convergence delegation --from reviewed-delegation.json --apply <exact-plan-id> --json
lervo knowledge convergence delegation --from reviewed-delegation.json --asset-manifest-from reviewed-assets.json --json
lervo knowledge convergence delegation --from reviewed-delegation.json --asset-manifest-from reviewed-assets.json --apply <exact-plan-id> --json
lervo knowledge worker --watch --provider codex
lervo knowledge worker --once --provider codex
```

The delegation command previews or durably applies an already reviewed complete object; it does not author a review. Revocation uses the same exact plan/apply path with `state: revoked`. Calls and writes recheck source, authority, and scoped leases. Revocation aborts in-flight capability-free generation where supported; an unresolved materialization journal remains an explicit recovery obligation.

Supplying a reviewed asset manifest includes its exact desired bytes and both authority preimages in that same plan. One durable journal applies both files and the existing materialization event records their counts and hashes. Concurrent replacement refuses the entire plan. Failed event recording rolls back both files or retains explicit recovery uncertainty. Asset source drift continues to require a new exact disposition and verification; generic byte integrity never approves visual or runtime promotion.

## Discovery and bounded progress

Startup, canonical event changes, and a 60-second idle inspection discover existing debt and the last ordinary source edit. Event changes use a 30-second quiet window with a 60-second maximum delay. A bounded one-second event-head check supplements filesystem notifications. Only one repository cycle runs at a time; a pending wakeup survives an active cycle.

The seven stages are `assessment`, `canonical_review`, `canonical_integration`, `normalization_generation`, `normalization_review`, `normalization_apply`, and `lifecycle_verification`. Distinct agents generate, review, write, and integrate under durable provenance-bound assignments. Canonical drafts use a managed detached workspace, verification seal, exact integration ref transition, and exact repository materialization. Normalization compares exact sources, review units, semantic checks, candidate bytes, and independently approved output hashes before applying an accepted subset. Rejected families retain exact rejection evidence and do not repeatedly regenerate unchanged output or block another authorized family.

[ADR-0435](../../decisions/knowledge/repository/canonicalization/0435-continue-normalization-after-canonical-rejection.md) retains a rejected canonical batch while handing independent normalization debt to its own review pipeline. The `canonical_review` receipt binds a private `rejection_retained` proof and authorizes no integration. An exact historical rejection is reused without another model call. Ordered projection maintenance may proceed, but final lifecycle verification remains `attention_required/knowledge_semantic_review_rejected`; rejected and unassessed sources never count as semantic coverage or baseline `current`.

Before acquiring a canonical writer lease, the runtime compares every reviewed target preimage with the selected Git integration ref. Only exact canonically settled normalization lineage can explain an owned preimage change. Other mismatches record `waiting_authority/canonical_target_diverged` with a private exact target-ref/commit dependency. Source or target-ref changes trigger reevaluation; matching target bytes resume the existing review without another model call. Unchanged drafts are invalid semantic changes and cannot start an empty Git integration.

The [recovery and retention contract](recovery-and-retention.md) defines failed-assignment reopening, durable host-effect checkpoints, known completed-ref reconciliation, shared target generations, integrator closure, non-force workspace cleanup, bounded archival, and `assignment.convergence.archived`. Unknown effects remain owned uncertainty.

The owner atomically records a stage, queues its successor, and acknowledges its predecessor. It rechecks canonical source/context, private CAS receipt hashes, authority, and the exact lease at settlement. Seven verified stage receipts and a stable final lifecycle scan are required for baseline `current`. New sources explicitly supersede old baselines; old terminal events remain immutable.

The version-nine Lervo repository suite prepares detached candidate worktrees with an offline frozen dependency install and local package build before lint, typecheck, and runtime shards. The primary checkout retains its existing dependency environment. Preparation failure produces no candidate verification receipt or integration success; the integration ref must contain the source being verified.

An interrupted verification result is recorded as `knowledge_cancelled`, distinct from an actual `knowledge_verification_failed` result. The cancelled stage may resume only after its current source and delegation checks pass under a new live worker signal; neither result grants verification success.

Bounds include 1,024 active obligations, eight stages per cycle, 16 attempts with backoff, eight documents, 1 MiB of source per delegated batch, and eight provider calls. Durable call reservations precede actual invocation and survive crashes. Private budget projections retain at most 8,192 batches and prune only canonically terminal obligations. Shared host admission allows two background calls across providers, one per repository, with oldest eligible waiter fairness and admission deferral for active ordinary work. An existing call is not preempted when ordinary work arrives.

Foreground admission defers capability-free provider work for an ordinary assignment's current unexpired lease. Missing or invalid expiry remains fail-closed. Expired lease metadata alone cannot defer read-only generation forever. This scheduling predicate neither proves a native process stopped nor settles, cancels, reopens, or removes the expired assignment. Its uncertain effects, scoped write conflicts, exact source checks and integration recovery remain governed by the existing effect and lease contracts. The worker and explicit provider probe share this predicate; caller-supplied current-work observations may remain stricter.

Complete source capture defaults to 20,000 paths, 64 MiB per ordinary file, and 256 MiB total; overflowing the applicable bounds requires attention rather than a partial success. [ADR-0436](../../decisions/knowledge/repository/canonicalization/0436-reviewed-source-capture-and-bounded-canonical-worksets.md) permits an exact reviewed delegation to select a total capture ceiling up to 1 GiB and at most 32 reference-only repository links through optional `sourceCapture`. Every link binds its exact relative target and kind; targets must separately appear in the complete source inventory, chains and escapes fail closed, and the link remains unchanged. Opaque descriptor capture establishes no asset acceptance. Canonical worksets obey both the reviewed document/source-byte ceilings and the existing canonical request bound, advancing a complete durable cursor. Text review, sensitive local material, and opaque verified assets retain separate dispositions. Tracked assets are never silently classified as generated caches. Pinned before-commits remain reviewable beyond four commits; unavailable dirty history remains explicitly unsupported.

## Events, status, and privacy

Version 4 adds the following canonical events. All use the existing canonical envelope. Required nullable fields are present as `null`; they are not omitted.

| Event                                       | Required payload fields                                                                                                                                                                                                                                         | Meaning                                                                                               |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `repository.knowledge.baseline.requested`   | `obligationId`, `sourceSnapshotId`, `sourceSnapshotHash`, `policyHash`, `debtDigest`, `delegationHash`, four-kind `debtCounts`, `inputArtifactHash`, `requestedAt`                                                                                              | Exact captured baseline and atomic queued obligation; no semantic approval.                           |
| `repository.knowledge.stage.recorded`       | `obligationId`, `predecessorEventId`, `predecessorEventHash`, `stage`, `state`, `snapshotHash`, `assignmentId`, `leaseGeneration`, `attemptCount`, `inputArtifactHash`, `resultArtifactHash`, `nextObligationId`, `dependencyHash`, `failureCode`, `occurredAt` | Durable bounded outcome and continuation; stopped dependencies require their exact hash.              |
| `repository.knowledge.convergence.recorded` | `obligationId`, `originalEventId`, `originalEventHash`, `scope`, `terminalState`, `snapshotHash`, `canonicalDispositionDigest`, `normalizationCoverageDigest`, `lifecycleReceiptDigest`, `knowledgeSnapshotHash`, `successorId`, `failureCode`, `resolvedAt`    | Verified `current` or explicit `superseded` with a successor; neither rewrites historical resolution. |

`assignment.created` gains an all-or-none provenance set: `convergenceContractVersion`, `convergenceObligationId`, `convergenceBaselineEventId`, `convergenceBaselineEventHash`, `convergenceStage`, `convergenceInputArtifactHash`, `convergenceDelegationHash`, and `convergenceAgentId`.

| State                                  | Failure or continuation meaning                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `queued` / `running`                   | Durable work awaits admission or holds the exact current lease.                                               |
| `waiting_review` / `waiting_authority` | Exact review or authority dependency blocks progress; live path conflicts preserve user work.                 |
| `retry_scheduled`                      | A bounded retry has an explicit schedule.                                                                     |
| `stale`                                | Source or context changed; old evidence cannot authorize completion.                                          |
| `recovery_required`                    | A journal or uncertain host effect must be reconciled before new writes.                                      |
| `attention_required`                   | A deterministic source, semantic, policy, usage, capacity, or budget condition requires a changed dependency. |
| `current` / `superseded`               | Exact scope completed, or explicitly replaced by a newer obligation.                                          |

Public events expose bounded IDs, hashes, counts, timestamps, and normalized codes. Source paths/bodies, prompts, candidate prose, reviewer rationale, absolute paths, credentials, and native errors remain in owner-only private CAS or private projections. Scheduling rows retain at most 1,024 acknowledged entries or seven days; pruning never deletes canonical events or referenced CAS proof. Current replay projections retain active obligations and the last verified currency.

The source gate adds no canonical event. `knowledge_materialization_busy` means an
active managed reader or another writer prevented exclusive admission; it is a
bounded `retry_scheduled` failure with no source mutation. `knowledge_source_gate_invalid`
means the private lock file or transaction could not be trusted and requires
`attention_required`. Public records contain the normalized code only; native SQLite
errors, physical paths, and source bytes remain private. A managed run reports its
existing `repository_snapshot_failed` if source admission is busy or invalid.

Status separates `transport`, four-kind `debtCounts`, `outstanding`, `oldestAgeMilliseconds`, `activeStage`, `state`, `reason`, `lastVerifiedCurrency`, `baselineCurrent`, and `worker`. Debt counts are `null` when an interrupted journal prevents a stable scan. Historical verified currency remains visible but cannot establish present currency. Worker health is independently `healthy`, `degraded`, or `not_running`, with state, heartbeat, and reason. A private bounded heartbeat projection updates every 15 seconds, expires after 120 seconds, verifies process liveness, and retains at most 64 residents. Queue emptiness, heartbeat, and zero lint errors alone never establish `baselineCurrent`.

CLI inspection failure exits with status 1 and only a bounded normalized error code. It emits no successful status or currency claim, private source path, native message, or stack. An untyped failure is `knowledge_inspection_failed`; typed source-kind and capture-capacity stops remain distinguishable. Storage closes after an opened inspection fails. This diagnostic boundary adds no event or writer authority.

Quota/authentication pauses use native normalized observations. An unknown reset remains paused until an explicitly requested, capability-free native probe produces matching structured proof and observed usage:

```bash
lervo knowledge convergence provider-probe --provider codex --json
```

The probe shares host admission and current delegation. It cannot erase a newer pause, infer recovery from elapsed time, or automatically retry an unknown reset. Private evidence stores the native observation; public status contains its hash and normalized reason.

## Verification and remaining acceptance

[ADR-0437](../../decisions/knowledge/repository/0437-stream-validated-recent-execution-evidence.md) separates streaming recent execution evidence for interactive startup from complete-history compilation. Interactive readiness never establishes complete-history coverage. The legacy complete adapter retains its existing fail-closed limits. [ADR-0440](../../decisions/knowledge/repository/canonicalization/0440-page-complete-execution-evidence-for-canonicalization.md) gives full CLI knowledge operations a separate complete adapter with at most four pages, each bounded to 32,768 sources and 16 MiB. It validates every original through the pinned canonical head before returning any page. The tracked source-count and aggregate-byte policy still bounds the combined ordinary, verification, and event corpus. Complete collection alone never establishes semantic approval or full knowledge currency.

The [implementation evidence](../../evidence/quality/background-knowledge-convergence-implementation.md) records native installed no-Hub convergence, restart, and the last idle edit. The [roadmap](../../roadmap/knowledge/autonomous-background-convergence.md) retains unobserved acceptance gates. Production activation requires compatible installed readers and reviewed per-project writer/delegation transitions. Repository debt cleanup, AXLI verification prerequisites, and provider spend authority remain separate operations.
