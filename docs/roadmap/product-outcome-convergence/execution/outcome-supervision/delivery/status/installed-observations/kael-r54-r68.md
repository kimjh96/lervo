# Kael post-r54 natural-goal incident: r54–r68

## Intake and proposal routing

At 2026-09-23T14:16:52Z, Arca-next recorded a fresh `work.supervision.bound` for a human Discord request and admitted owner reasoning at 14:17:00Z. The model completed at 14:17:51Z. Its `escalate` result correctly identified that the request referred to four earlier-context tasks while the durable workstream exposed only three, but included bounded explanatory fields alongside `reasonCode`.

The r54 materializer recognized only the one-field local-attention shape and sent every other `escalate` detail object to the scoped-handoff builder, which rejected the missing recipient. The same persisted result then failed every cycle with `supervision_cycle_failed` and no business effect. Process liveness and a prior no-new-request observation did not detect this post-request failure.

The source correction makes local attention and scoped handoff disjoint, accepts bounded optional explanation for local attention, and settles malformed mixed shapes as one exact `owner_proposal_invalid` local attention. Focused restart tests cover one recorded effect instead of repeated cycle errors. Source results are not installed acceptance: the corrected bundle must be rolled out, the persisted decision reconciled exactly once, and supervision health and outward result claims observed independently. A separate upstream issue remains: deictic Discord requests are bound as durable goals without preceding conversation context. Owner reasoning must not invent the missing fourth task.

The 2026-09-23 incident exposed a second intake defect: the bound artifact preserved only “those four tasks through deployment,” although the immediately preceding delivered Discord answer identified all four scopes. ADR-0428 requires a versioned immutable prior-turn snapshot at new Discord goal admission and source re-verification before owner reasoning. This local implementation change is not installed Kael acceptance. The already-bound version-one request remains unchanged; recovery must use a reviewed canonical goal revision or newly authorized successor, never fabricate a context snapshot for the historical binding.

## Native task and shell readiness failures

Later r54 observations exposed two independent boundaries. A completed owner result used `arca_next/expanded_learning/**`, violating the canonical exact-path contract; the old owner replayed it and logged the same `TypeError` every cycle. After Arca-next source revision 337, a newly admitted `work.managed_execution.v1` dispatch required `shell.execute`, but the native canonical-readiness adapter mapped only filesystem capabilities. It repeatedly logged “no reviewed tool mapping” before worker invocation.

Source changes validate native task details before business planning, use exact-hash feedback for at most three model correction attempts, and map authorized shell duties through role plus configured CLI executable readiness. Local fixtures cover correction across restart, bounded exhaustion, positive shell mapping, and missing-tool nonpromotion.

## r56 and r57 restart behavior

Immutable Linux r56 archive `sha256:f5f0364cb7a1aa68dc1561788d65c31d0e8d682d18ae068449ad8e5de8a65098`, containing commit `810dba9c`, passed archive verification, installation, and config preflight. Kael's r54 service definition was preserved exactly; systemd was transactionally upgraded to r56 at 2026-09-23T16:03:25Z. PID `3098458` had zero restarts and fresh ready conversation, synchronization, and supervision health. No r56 cycle error was observed, but health did not prove continuation.

Sequence 7326 recorded workspace preparation at 16:03:23Z. The startup cursor deferred the old bound request until lease expiry changed the canonical source. r56 resumed at 7327, 16:08:52Z. The delay was real; the earlier claim that r56 never resumed was incorrect. Later r56 decisions reached dispatch without proving worker start or accepted completion.

ADR-0429 corrects restart deferral. Commit `66db6897` was packaged in immutable Linux r57 archive `sha256:87a7ed04f93b2668759af19cd0fe025318e1ae5ce815f97e9b14f42a10765135`. Kael was transactionally upgraded at 16:24:01Z, retaining the exact r56 definition for rollback. At 16:31:53Z conversation was `ready`, while supervision reported `supervision_attention_required` with tools, CLI, knowledge, verification, and budget readiness unobserved.

The live configuration has no reviewed `role.development.artifact` suite pins or tool mappings, so managed execution must remain unobserved until genuine review and configuration. Budget had a separate policy mismatch: the installed V3 mandate is `per_attempt_only`, while canonical worker readiness treated missing cumulative usage as failure. At that point the local correction was under verification, not installed acceptance.

Acceptance still requires an exact post-restart decision, worker safe-start or safe-non-start evidence, no recurring cycle failures, and independently observed publication. The separate Arca-next agent's in-progress work and candidate snapshot are not claimed completed or deployed.

## r58 budget policy and service lifecycle

Budget correction `0dfab5d4` was packaged in immutable r58 archive `sha256:945d19c519793552ea4c2b22d9be2fe4dc876729fcaf0fe88be04e08754394a8`. Installation and Kael config preflight passed, but the first transactional upgrade failed before activation. r57 took about 39 seconds to stop cleanly, exceeding the wrapper's fixed 30-second command deadline while remaining below rendered `TimeoutStopSec=120s`.

The wrapper returned `service_upgrade_failed`, restored the exact r57 definition, and left the service inactive. An explicit start restored r57 at 01:50:41 KST, process `3219159`, active/running with zero restarts. r58 was installed but inactive; its readiness improvement was not yet observed. Another activation required a lifecycle-aligned stop deadline and inactivity reconciliation after ambiguous command results.

Commit `f5a5d6a6` aligns stop-command timeouts with rendered service lifetime and reconciles actual inactivity after ambiguous stop results. Its 37 focused service-renderer and manager tests passed, along with type, quality, documentation, and base-bound release checks (`intent_pending`). Once the remote Lervo checkout mirrored it, the same exact r58 archive and service definition upgraded Kael transactionally at 01:57:41 KST.

The installed definition matched reviewed r58 bytes; process `3239142` was active with zero restarts. At 16:58:26Z conversation was `ready`; supervision still reported attention for tools, CLI, knowledge, and verification, but no longer reported budget unobserved. This proves the installed budget-policy correction, not managed-worker acceptance. Live Arca-next configuration still lacked verification suite pins and tool mappings, its required `role.development.artifact` definition was absent, and one expected document awaited normalization. No worker start, verification result, accepted task, or delivered completion is claimed.

## r64–r66 terminal interruption reconciliation

Kael r64 activated the guarded Node upgrade path with a preserved service definition, process `3789755`, zero restarts, and ready conversation, event sync, and workstream replication. Supervision remained `pending_decision_requires_reconciliation`.

Owner run `run_eadbb9b137f6a40d2b4501817f5fb250` recorded a read-only adapter start, process observations without progress, unavailable provider usage, and a nonretryable `provider_stop_failed` terminal without `adapter.stopped`. A host unit-invocation witness proves the process ended before a successor invocation. ADR-0430 defines distinct reader-first reconciliation for this shape. Safe replay and worker completion remain unestablished until compatible readers are deployed and the exact event written and verified.

Hub and Kael Node r65 from `377029df` were deployed with CLI/Hub/Node schema-3 readers. On 2026-09-24, the explicit owner-fenced command recorded exactly one `work.supervision.owner_reasoning.interruption_reconciled` event (`evt_e0db7d8f4e9b7c16404aceb8fe450ecc`, sequence 8284), and the new CLI verified event-chain integrity.

The next Node cycle failed with `The supervision effect evidence is unavailable or noncausal.` The concrete inspector recognized reconciliation, but the generic decision journal rejected the new supervision event as decision-bound effect evidence. A full post-reconciliation-cycle fixture reproduced it. Source commit `4a5cf49f` binds the deterministic event ID, decision coordinates, and exact earlier terminal before confirmation. Unknown token use, worker execution, review, and publication remained open.

Node r66 from `4a5cf49f` was installed from verified archive `sha256:05dd470cb0d32b10302883427903f3d3ed292fa2bd6380dac733c291ad5daa13` and transactionally upgraded with the r65 definition preserved. Process `3929734` had zero restarts. Event 8285 confirmed the reconciled decision exactly once; fresh owner attempt 2 was admitted under installed V3 `per_attempt_only`.

That policy intentionally does not apply wire-format `maximumAggregateTokens: 100000` as a cumulative admission limit. The earlier claim that its full reservation barred retry was incorrect. Attempt 2 failed before `adapter.started` with `provider_start_failed` (8287–8293); event 8294 recorded its uncertain decision state.

Subsequent cycles reported `A provider resource observation differs from its run provider.` The generic resource projector rejected the unavailable provider-report receipt for the pre-start terminal. Owner-start revalidation separately used the unfiltered projector instead of admission's reconciliation-aware source. Both boundaries needed source correction and installed verification. Failed start proves no provider work, successful result, or safe attempt reset.

## r67–r68 start-failure reconciliation and attempt ceiling

Node r67 from `1dbe4477` was installed from verified archive `sha256:d2b5715ec590c737045f5d52ae37fc8be1c3f069ae886b17c38d0b48836d8ce4` and transactionally upgraded with the r66 definition retained. Process `3967654` had zero restarts; conversation, sync, and replication were ready. Repeated resource-projection `TypeError` stopped. Supervision reported specific `pending_decision_requires_reconciliation` for attempt 2 instead of an unclassified cycle error.

An ADR-0430 source extension proves an exact terminal unacknowledged-start shape with a successor unit witness, keeps unknown usage and full reservation, and confirms only failed invocation state. Its full-cycle fixture passed, but a reader supporting that proof had to be installed before the second reconciliation. The installed mandate allowed only two attempts; more required a separate reviewed authority change.

Node r68 from `b58c19ae` was installed from verified archive `sha256:59209bbcb86a3fcbe6a1abeedc4c2d7b3c615d4546cb55c1857ae8ef29bcc747`, preserving the r67 definition. Process `3992730` was active with zero restarts and ready conversation, sync, and replication. The explicit owner-fenced command recorded one start-failure reconciliation (`evt_e2ce18be5269e51885bfbc1b61908573`, sequence 8295). Sequence 8296 confirmed that exact failed decision; the 8296-event chain verified valid.

A subsequent cycle reported `owner_plan_unavailable`, not a recurring exception: the native owner refuses a third reasoning plan under the two-attempt mandate. No third decision, managed worker start, independent review, or publication exists. Another invocation requires a reviewed mandate amendment or newly authorized goal; reconciliation granted neither.
