# Installed observations and remaining work

The [implementation status](../status.md) defines the completion boundary and links the evidence and decisions supporting these observations. Implemented or observed behavior does not by itself close the full installed acceptance gate.

## Natural goal-intent migration

ADR-0410 replaces the guild `/goal` entrypoint with an ordinary managed conversation turn and its `supervision_goal_request` effect. Source fixtures distinguish this from one bounded `repository_work` task and bind human provenance to both the native inbox and immutable intent row.

Installed evidence must remove the old registered command, classify one unmentioned durable-goal request, bind it through the standing owner, and deliver its independently accepted result. Historical slash-command journeys remain valid admission-writer evidence but do not prove this semantic ingress.

## Central and direct intake

Source code binds one authenticated Discord or local request through the installed owner lease and `work.supervision.bound`, preserves the configured product owner after a separately deployed hire, and reads a request-bound result origin.

Installed central/direct journeys bound one central guild `/goal` and one identical local stdin request on successive goals into the same owner, worker, verification suite, and independent review. The central result reached its channel while the central speaker remained silent. A concurrent direct request on an active goal was refused without writing.

Two refused Discord requests were incorrectly acknowledged as connected: intake refusal reached the command handler as an ordinary response failure, and the 30-second fence deadline expired during an owner cycle. Revision `8a673eb2` types refusals, repeats only the recorded per-event outcome, and waits 120 seconds on the Discord path.

On the corrected bundle, the same request reached a second Discord recipient through its own reviewed goal (bound 13982, delivered 14202). A Discord request against a goal already working its local request was refused as `owner_busy`, without binding or a connected claim. Installed `origin_conflict` wording was then observed on the fourteenth goal by sending the Discord request before the first owner cycle.

## Permission recovery and resumed execution

Source classifies operating-system permission denial separately from a missing executable, records `work.supervision.readiness.failed` once per failed-check set without changing the task source digest, exposes bounded attention reason codes in supervision health, and resumes the admitted decision after repair. Disposable Mac fixtures prove this behavior.

The installed WSL journey recorded six safe non-start events and one resumed dispatch after host repair. It also showed that CLI, Node, and Hub readers must share this revision.

Successive installed goals isolated managed-worker defects: an unrenewed assignment lease aborted the first resumed run during verification; late dispatches lacked pre-launch renewal; and renewal advanced the pinned assignment revision.

On corrected bundles, the fourth goal retained one recorded dispatch decision and one failure record across blocked cycles. After repair, the same decision renewed its lease, ran the Codex worker, passed pinned research verification, and received an accepted independent review. Bounded preflight and managed-abort cause codes support later diagnosis.

The owner escalated instead of completing because the goal named recovery itself as acceptance criteria, which canonical owner facts do not expose. The goal was narrowed to the research outcome for completion.

## Local and Discord equivalence

Broader installed equivalence remains to be established beyond one bounded read-only research pair, including worker permission recovery, central/direct handoff, restart, and changed requirements.

The local research goal and a distinct authenticated guild `/goal` successor are accepted and completed; the Discord result has a native transport receipt. An earlier successor's accepted text retained a stale pre-delivery status sentence. A later authenticated guild `/goal` journey delivered a time-stable answer on its first attempt (WSL 13280–13501), proving that instruction installed.

WSL goals 13502–14202 demonstrate central/direct intake into one owner and assignment set, a second recipient through a separate reviewed goal, and a bounded local/Discord equivalence triple. Source, verification, review, and delivery were equivalent; the worker's interpretive pairing varied once.

## Restart and requirement changes

A deterministic stop between `work.supervision.workspace.prepared` and dispatch resumed with one dispatch and no duplicate allocation, claim, workspace, or hire (WSL 14587–14732). A `SIGKILL` one second after a claim was reconciled on automatic restart.

A requirement change while an unstarted assignment held a live lease did not reach amendment: the owner continued the lease, and the goal was accepted against pre-change criteria (14890–14923).

When the claim lease expired before the owner resumed, the same change reached a versioned amendment (`assignment.amended` 14997), successor claim, review-driven rework, accepted second attempt (15237), and completion (15270). Scenario 9 is therefore observed installed for expired unstarted leases.

Revision `ae18dfa9` makes the Node refuse to prepare or dispatch a responsibility bound under an earlier goal revision and list it to the owner. On that bundle, a live-lease change escalated as `goal_revised_lease_pending`, was amended after expiry (15374), reworked once, and independently accepted (15614), with no stale workspace or dispatch.

Revision `f174370d` makes completed locally bound goals report `local_result_canonical`. They previously reported `owner_plan_unavailable` attention because nothing was publishable. A graceful stop immediately after a claim leaves a prepared checkout; amendment now retains it when the Node proves it unstarted.

## Scoped service activation

Following these installed observations, the service was enabled for boot and tested through a controlled WSL restart. All nine Lervo units were running within ten seconds of guest boot; the scoped Node reached ready sync and conversation health on Node bundle `b3a30054`.

The fifteenth goal had exposed a capacity fault: the repository crossed the 8,192-event complete execution-event source cap, causing every owner cycle and Node startup to fail closed. The failure remained invisible until revision `fd6cf5e5` added bounded cycle-failure logging. ADR-0403 raises the cap to 32,768; Node and CLI bundles were redeployed together.

Remaining follow-ups are a reviewed execution-event source compaction design, the idle scoped Node's 0.1-core usage, and two time-dependent `supervision-native-completion` fixtures.

## Standing supervision

ADR-0405 replaces the one-mandate-per-goal transition with a reviewed standing grant. A root mandate with `successorAuthority` lets the installed owner start a successor goal and derive its mandate for each bound request. The scoped service follows verified lineage without restarting.

The installed standing lineage started its first successor goal from a local request without an operator step. That goal exposed a stalled rework claim. ADR-0406 introduced claim supersession, a thirty-second admission margin, and a ten-minute completion floor; the corrected bundle's first cycle reconciled the claim in production.

A separately current workstream previously made the pinned standing owner log `cycle_error_unclassified` every five seconds. The source now types that state as `supervision_workstream_inactive`; the installed service treats it as dormant pending lineage evidence, retains event-driven wakeup, and limits fallback checks to once per minute without reporting false unavailable health.

Remaining follow-ups are bounded assignment failure for a successor responsibility whose window elapsed before its claim, and Discord `/goal` proof of consecutive successor goals. The latter needs the operator's Discord session.

## Unqueued publication recovery

The standing Lervo goal completed at revision 4, then a deployment stopped after admitting `publish_result` and before queueing its outbound. A repository-knowledge migration advanced the task source and exposed `pending_decision_requires_reconciliation`; restart alone could not settle the decision.

ADR-0416 adds queue-absence supersession for this exact pre-transport boundary. Installed acceptance requires the upgraded Node to record one version-8 absence-backed supersession, make a fresh publication decision without rerunning accepted worker work, and return supervision health to ready. Any existing queue event, transport observation, stale inspection, or lost owner fence must fail closed.

## Kael post-r54 natural-goal incident

At 2026-09-23T14:16:52Z, Arca-next recorded a fresh `work.supervision.bound` for a human Discord request and admitted owner reasoning at 14:17:00Z. The owner model completed at 14:17:51Z. Its `escalate` result correctly identified that the request referred to four earlier-context tasks while the durable workstream exposed only three, but supplied bounded explanatory fields alongside `reasonCode`. The r54 materializer recognized only the one-field local-attention shape and sent every other `escalate` detail object to the scoped-handoff builder, which rejected the absent recipient. The same persisted result then failed every cycle with `supervision_cycle_failed` and no business effect. Process liveness and a prior no-new-request observation did not detect this post-request failure.

The source correction makes local attention and scoped handoff disjoint, accepts bounded optional explanation for local attention, and settles malformed mixed shapes as one exact `owner_proposal_invalid` local attention. Focused restart tests cover one recorded effect rather than a repeated cycle error. This source result is not installed acceptance: the corrected bundle must be rolled out, the existing persisted decision reconciled exactly once, and supervision health and outward result claims observed independently. The separate upstream issue remains that a deictic Discord request is bound as a durable goal without its preceding conversation context; owner reasoning must not invent the missing fourth task.

The Kael 2026-09-23 incident exposed a second intake defect after proposal routing: the bound artifact preserved only “those four tasks through deployment,” while the immediately preceding delivered Discord answer identified the four scopes. ADR-0428 requires a versioned, immutable prior-turn snapshot at new Discord goal admission and source re-verification before owner reasoning. This is a local implementation change, not yet an installed Kael acceptance result. The already-bound version-one Kael request remains unchanged; recovery must use reviewed canonical goal revision or a newly authorized successor, never fabricate a context snapshot for that historical binding.

Later Kael r54 observations found two additional independent failure boundaries. A completed owner result used `arca_next/expanded_learning/**`, which violates the canonical exact-path contract; the old owner replayed that result and logged the same `TypeError` every cycle. After Arca-next source revision 337, a newly admitted `work.managed_execution.v1` dispatch required `shell.execute`, but the native canonical-readiness adapter mapped only filesystem capabilities, so it logged “no reviewed tool mapping” repeatedly before worker invocation. Source changes validate native task details before business planning, use exact-hash feedback for at most three model correction attempts, and map authorized shell duties through role plus configured CLI executable readiness. Local fixtures cover correction across restart, bounded exhaustion, positive shell mapping and missing-tool nonpromotion.

The immutable Linux r56 archive `sha256:f5f0364cb7a1aa68dc1561788d65c31d0e8d682d18ae068449ad8e5de8a65098` containing commit `810dba9c` passed archive verification, installation and config preflight. Kael's r54 service definition was preserved exactly, and its systemd service was transactionally upgraded to r56 at 2026-09-23T16:03:25Z. The new PID `3098458` had zero restarts and fresh ready conversation, synchronization and supervision health. No r56 cycle error was observed, but health alone did not prove task continuation. Sequence 7326 recorded workspace preparation at 16:03:23Z. The startup cursor then deferred the old bound request until the lease expired and changed the canonical source; r56 resumed at sequence 7327 at 16:08:52Z. The delay was real, but the earlier claim that r56 never resumed was incorrect. Later r56 decisions reached dispatch, without proving a worker start or accepted completion.

ADR-0429 corrects that restart deferral boundary. Commit `66db6897` was packaged in immutable Linux r57 archive `sha256:87a7ed04f93b2668759af19cd0fe025318e1ae5ce815f97e9b14f42a10765135`; Kael was transactionally upgraded at 16:24:01Z with the exact r56 service definition retained for rollback. At 16:31:53Z its conversation was `ready`, while supervision reported `supervision_attention_required` with tools, CLI, knowledge, verification, and budget readiness unobserved. The live configuration has no reviewed `role.development.artifact` suite pins or tool mappings, so managed execution must remain unobserved until genuine review and configuration. The budget finding has a separate source-policy mismatch: the installed V3 mandate is `per_attempt_only`, while canonical worker readiness still treats missing cumulative usage as a failure. A local correction is under verification, not installed acceptance. Acceptance still requires an exact post-restart decision, worker safe-start or safe-non-start evidence, no recurring cycle failures, and independently observed result publication. The separate Arca-next agent's in-progress work and candidate snapshot are not claimed as completed or deployed.

The budget-policy correction was committed as `0dfab5d4` and packaged in immutable r58 archive `sha256:945d19c519793552ea4c2b22d9be2fe4dc876729fcaf0fe88be04e08754394a8`. Installation and Kael config preflight passed, but the first transactional service upgrade failed before r58 activation. The previous r57 process took about 39 seconds to stop cleanly, exceeding the service manager wrapper's fixed 30-second command deadline while remaining below its rendered `TimeoutStopSec=120s`. The wrapper returned `service_upgrade_failed` with the exact r57 definition restored but the service inactive. An explicit start restored r57 at 01:50:41 KST with process `3219159`, active/running and zero restarts. Thus r58 is installed but not active and its readiness improvement is not yet observed. The service manager requires a lifecycle-aligned stop deadline and an inactivity reconciliation after ambiguous command results before another activation attempt.
