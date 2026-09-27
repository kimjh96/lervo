# Supervised workspace preparation

When a dispatched responsibility lacks a workspace, the native owner derives a separate `work.workspace_preparation.v1` proposal. Its six-field version-1 effect binds the current responsibility, provider, exact provision-plan artifact, and rationale. The model never invents lease IDs, host paths, or readiness evidence.

## Configuration and authority

Trusted Node readiness configuration supplies an existing canonical parent directory outside the repository, an exact Git base commit, and an integration-target digest. The child path derives from the assignment and lease. Preparation rejects:

- A symlink parent.
- Another workspace for the assignment.
- A changed responsibility.
- An expired lease.
- An incompatible host coordinate.

The configured base is an explicit host choice; preparation does not copy uncommitted repository changes.

The existing workspace planner binds the assignment revision, lease generation, repository instance, ownership marker, and host version. The Node adapter rechecks authority, revocation, canonical sources, deadlines, and its owner fence before preparation, immediately before Git creation, and before recording completion. The host uses the existing detached-worktree adapter. Observation remains read-only; the separate admitted effect owns provisioning.

## State and recovery

The canonical workspace transitions from absent to provisioning to ready. An interrupted host mutation retains the workspace and `recovery_required` evidence; it never triggers force removal. An already-started Git operation may finish after authority changes. Revalidation prevents claiming a supervision receipt after authority is lost. Once the host and canonical coordination evidence have reached ready, a receipt callback failure preserves that ready state; receipt uncertainty does not undo preparation.

After a crash between ready-state persistence and its supervision receipt, the owner may recover the exact historical preparation under current owner reconciliation authority, even after the preparation deadline or original assignment lease expires. Legacy revision-three `recovery_required` records qualify only when their entire history consists of the exact provision, ready, and `host_effect_uncertain` transition, and the complete record matches that history. It inspects the live host and canonical coordination events, verifies a clean checkout at the exact base with the exact ownership marker and native instance digest, excludes managed dispatch for the responsibility, and rechecks the workspace, source, event head, and current owner fence within five seconds. It then records the missing historical ready receipt without another Git mutation, a lease renewal, or a workspace-state rewrite. Retained legacy records remain recovery-required; they cannot authorize dispatch. A later lease generation still needs its own readiness and workspace evidence. An absent workspace under an unexpired recorded decision remains uncertain and does not authorize another host preparation. Other partial states remain uncertain.

An expired or source-invalidated preparation decision may be superseded only when its exact workspace record, coordination events, Git registration, and filesystem path are all absent. Under the current owner fence, the adapter repeats these observations and binds the event head before recording `work.supervision.decision.superseded`. It never removes a path, releases or rewrites the assignment lease, or changes the responsibility. Existing host material or partial canonical work remains uncertain. Before another preparation, the ordinary owner workflow must separately revise an expired responsibility and resolve its lease.

Governed CAS inspection uses `work.effect_absence` schema version 3 with required fields: `schemaVersion`, `kind`, `effectContract`, `decisionId`, `planHash`, `effectHash`, `sourceRevisionDigest`, `workspaceId`, `provisionPlanHash`, `workspaceRecordAbsent`, `coordinationEventsAbsent`, `hostRegistrationAbsent`, `workspacePathAbsent`, `eventHeadHash`, `observedAt`, and `invalidatedBy`.

All four absence observations must be true. `invalidatedBy` is `source_changed` or `deadline_expired`; `deadline_expired` requires an observed time at or after the exact plan deadline. Recovery rechecks the provision artifact and workspace identity. The supersession event retains the existing version-1 payload containing opaque supervision coordinates, decision and plan hashes, the inspection artifact hash, and the current source digest. No path, prompt, credential, or unbounded error enters the event. Invalid or incomplete evidence grants no recovery authority.

New native responsibilities allow preparation for at most five minutes or one third of their bounded completion duration, whichever is shorter. Progress falls within ten minutes or two thirds of that duration. These deadlines include allocation, claim, and host preflight; they do not extend an existing responsibility or its mandate.

## Preparation receipt

`work.supervision.workspace.prepared` uses envelope version 3, payload version 1, and the common supervision coordinates. It also requires `decisionId`, `planHash`, `assignmentId`, `workspaceId`, `provisionPlanHash`, `workspaceArtifactHash`, and `coordinationEvidenceHash`.

Paths and host observations remain in governed CAS artifacts; the event contains only IDs and hashes. A deterministic receipt binds the preceding admitted decision to the exact ready state and coordination events. It proves historical preparation, but not a live lease, provider start, artifact acceptance, or goal completion.

## Dispatch and validation

Before dispatch, the native owner rereads the current responsibility, lease, and actual Git workspace evidence, then proposes a separate `work.managed_execution.v1` effect. Existing context, tools, native login, verification, budget, and repository admission continue to apply. A missing or damaged workspace is never fabricated as ready.

The native-protocol fixture covers one owner invocation followed by canonical allocation, responsibility acquisition, and real Git workspace creation. Separate host tests cover authority loss before creation and failure after host creation. These tests do not establish installed Discord acceptance or full automatic worker completion.
