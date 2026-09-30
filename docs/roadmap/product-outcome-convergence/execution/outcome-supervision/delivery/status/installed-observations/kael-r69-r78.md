# Kael post-r54 natural-goal incident: r69–r78

## r69 maintenance and r70 authority change

On 2026-09-24 the owner approved a brief one-time maintenance transition. Verified r69 archive `sha256:32bebb12e14382247dc6b9f62af5582d9abffc754c24e67b7f4f85fde1c103c3` was activated by exact r68 removal and r69 installation after read-only inbox/outbox and process checks. The installed definition matched rendered r69 bytes. Process `176798` had zero restarts and registered the new SQLite work-admission session. Conversation, sync, workstream replication, and remote control were `ready`; supervision remained `unavailable/owner_plan_unavailable` under the two-attempt mandate.

This first transition does not prove zero loss of a non-replayable Discord interaction. The owner separately approved changing only the attempt ceiling from two to three; no revised mandate or third run was then installed. Acceptance required verifying that a reviewed root-mandate revision follows the configured ancestry pin, observing its hash in the running owner, and inspecting one bounded managed attempt with transport diagnostics. The separate 200,000-total-token reapproval procedure did not change current per-attempt-only authority.

Commit `80170fae` was built on the Kael Linux host as verified r70 archive `sha256:e4519ef77d1507b4de25ea43ad2bb78d204e09d119298bd9e356698536892959` and activated through the r69 work/supervision-fenced upgrade. Process `203043` registered the new admission session and reported ready conversation and replication.

Reviewed root mandate v2 changed only `version: 1→2` and `maximumAttemptsPerAssignment: 2→3`. Event 8297 installed hash `sha256:e2d94b22a31391f680f54310104955274a54f7a474ba4cc0ef2e4144e93dd597`; event 8298 proved the running owner used it. Codex `gpt-6-sol` owner run 8301–8326 completed with 70,039 observed tokens; run 8340–8365 completed with 70,219. These prove owner reasoning, not managed-worker acceptance.

A subsequent `dispatch` was independently superseded with `runEventsAbsent: true` and `invalidatedBy: source_changed`. Later dispatches repeatedly failed before worker start as `supervision_preflight_failed/supervision_authority_changed`. That code combined stale admission and several source-drift boundaries, leaving the exact cause unestablished. Repeated owner replanning under `per_attempt_only` spends additional tokens without clearing the worker result gate.

## r71–r73 stale preflight and revocation

Commit `38b1a84e` separates bounded preflight failure codes without weakening the five-second freshness rule. Verified Linux r71 archive: `sha256:0b16eaaf698973a9bb03237197b0512f4461e4bf14c46e906621f82877e9c3c4`. The protected r70-to-r71 upgrade first refused `service_upgrade_supervision_busy` while an owner cycle held the lease, then succeeded during an observed released interval. Process `319511` was active with zero restarts; its definition matched r71 and conversation, sync, and replication were ready.

At that observation, the earlier pending `dispatch` had no run events. The read-only task projection reported `worker_deadline_elapsed` and next action `inspect_uncertain_effect`; service health reported `effect_mapping_unavailable`. New preflight codes had not yet been exercised. No worker start, verification, independent review, publication, or historical provider-start cause was claimed. The pending decision had to be preserved until exact non-start inspection allowed supersession or a new effect.

r71 subsequently recorded another `dispatch` at 8491. Before any worker run, health reported `supervision_preflight_failed/supervision_admission_stale`: final admission exceeded its five-second freshness window during preparation. This proves the installed failing boundary, not permission to extend the window. The source correction re-reads exact task and authority admission after costly context and final probes. Focused tests prove a delayed first read cannot be reused and a failed late read blocks. It was not installed in r71; worker acceptance remained open.

Commit `f9b8a823` was built on-host as verified r72 archive `sha256:a0feceb78fd8bd1f227bd576c89346cd97f67e1d4f1dd28564672db0782e1e88` and installed through the protected released-lease upgrade. Process `380705` was active with zero restarts and an exact r72 definition. Ordinary conversation, sync, and remote control were ready.

Stale pending `dispatch` 8530 was superseded at 8531 with exact `runEventsAbsent: true` and `invalidatedBy: source_changed`. A new responsibility and workspace were prepared, but dispatch 8569 failed before worker invocation as `supervision_preflight_failed/supervision_readiness_stale`. r72's late admission fixed the first stale witness; canonical readiness still dated earlier context preparation. The next source correction moves only final mutable-readiness observation into the same five-second window as final admission, preserving the earlier context validity bound. It required separate build and installation; no managed worker start or accepted outcome was claimed.

Commit `c97e512c` was built as verified Linux r73 archive `sha256:5b61ae9fbe726b01a4a7c1777940b5ea4c37e19c49a9c192e82b413e0abc53b7`, installed inactive, and passed exact Kael config preflight. Before activation, the owner explicitly selected supervisor-only mandate revocation to stop repeated costly planning while preserving ordinary Discord conversation.

The built CLI initially could not acquire the live owner lease. Bounded exact guarded retries acquired it on attempt 26 and recorded `work.supervision.mandate.revoked` at 8648 (`evt_57e4827d6d60c9b66ebc7ff718f3be59`). Fresh inspection returned `revoked: true`. The protected r72-to-r73 upgrade succeeded; process `472959` was active with zero restarts and an exact r73 definition. Conversation, sync, and remote control were ready, but supervision remained pending/unavailable because dispatch 8647 required reconciliation.

r73 worker preflight is not accepted in production: no post-install managed worker start was observed. A reviewed mandate must not be installed merely to clear health; reapproval must retain the separate token-cap decision and exact pending-effect recovery.

## Pending dispatch and spending evidence

Read-only inspection of dispatch 8647 found exact managed run ID `run_a701bb06ab60e0d80cf6f925fd994e4b`, `runEventsAbsent: true`, start deadline 2026-09-24T03:13:37.773Z, and plan deadline 03:20:17.773Z. This is neither canonical supersession nor permission to launch after revocation.

Nine `resource.usage.recorded` receipts since mandate-v2 installation at 8297 total 631,128 observed tokens, all owner reasoning. This is neither a monetary estimate nor complete historical usage. It already exceeds the earlier proposed 200,000-total-token ceiling. A new incremental budget epoch is distinct authority, not a retroactive assertion that the old goal stayed below 200,000.

Proposed ADR-0431 specifies a durable non-start barrier and cumulative owner-reasoning spend boundary. At source revision `def41584`, only readers accepted bounded version-3 `work.supervision.preflight.blocked`; no writer or barrier projection was implemented or installed. Completion requires reader-first rollout; restart-safe, provider-neutral barrier and budget fixtures; reviewed post-revocation allowance if spending resumes; exact recovery of dispatch 8647; and installed proof that the same blocker does not trigger another costly owner proposal. Ordinary Discord availability and worker acceptance require separate checks.

The owner subsequently chose a procedure for up to 200,000 additional post-revocation tokens, not immediate provider spending. Read-only inspection at 8648 found 55 owner-reasoning runs in the bound goal: 49 observed provider receipts totaling 3,364,545 reported tokens and six unavailable receipts retaining 100,000-token reservations each.

The whole-group projection's `reservedAggregateTokens: 5,500,001` is not actual usage: a partial group also reserves historical observed runs. Receipts span model descriptors; no exact cross-model historical aggregate admission is inferred.

Commit `6302cc6d` adds a revocation-anchored, full-reservation owner allowance inherited across successors, a fenced final-start check, bounded preflight-block writer, and no-replan barrier after supersession. Focused local tests prove those contracts, but not safe repair of a changed-source block, managed worker start, or accepted result.

## r74 installation and CLI binding

On 2026-09-24, verified distributions from `6302cc6d` were installed immutably: Node r74 `sha256:1c8733c1ed8ff6629d3cace27d3d68e12a1c617199c66c9692362fc8f3ea725c` and Hub r66 `sha256:78e453ffabdfe5eb9fe0c5f65c7be02fe4326c23121a6bc9f8c04bcd2ac02856`. Protected upgrades completed without observed restarts. CLI `settled-6302cc6-r74` was installed and byte-compared to the source build.

Kael's existing Node configuration still named two older CLI bundles, so the owner separately approved brief maintenance. A new owner-only configuration changed exactly `discordConversation.deliberation.cliExecutable` and `outcomeSupervision.managedExecution.cliBundle` to r74 CLI and passed r74 Node preflight.

With predecessor supervision owner leases and Node work-admission freeze held, the exact predecessor service was removed and the exact replacement installed. Node became active and enabled at PID `1089221`, zero restarts; Hub remained active at PID `1063897`, zero restarts. The installed definition equals the rendered replacement, and both running configuration references equal r74 CLI.

At `2026-09-24T08:43:08.505Z`, conversation, sync, workstream replication, and remote control were `ready`. Overall health remained `degraded`: supervision reported `supervision_authority_unavailable`, and exact installed mandate inspection still returned `revoked: true` at `evt_57e4827d6d60c9b66ebc7ff718f3be59`. No new mandate, provider spend, worker start, or accepted result was claimed. Dispatch 8647 and changed-source preflight repair still required exact review before reactivation.

## r75 terminal reconciliation

Commit `e0021ce0` was built as verified Linux Node r75 archive `sha256:3f72256c68f9702956ec59d6cd3b470348646536287b0c4a327db74b83205d0a` and installed through the protected upgrade. Node process `1294585` was active with zero restarts; Hub stayed at r66.

After one cycle, event 8649 (`evt_5eb79dad4f3a0276796af1a7564c9aa6`) superseded dispatch 8647 using exact run-absence inspection `sha256:401279143108aba9a44f0ac0478bf52ef0221a80663e4b8ac1d6f1e85449cc96`, with `runEventsAbsent` true and `invalidatedBy` `deadline_expired`. The chain verified through head `sha256:853ef5d12696260d462db54847b4afe473acf613edf3069af652343f02e99f13`; no pending decision remained.

Terminal reconciliation did not reinstate the revoked mandate, spend tokens, or launch a worker. Conversation and sync were ready; supervised worker acceptance and publication remained unproved.

## r76–r77 usage limit and proposal spending

Commit `00db0946` was installed as Hub r67 and Node r76 through protected upgrades. Reviewed mandate v3 (`sha256:59c069047d838479f750b8fb365906501b41b860b7de3a090f3694a37d882715`) was installed at 8650 with a 200,000-token incremental owner allowance.

First owner run `run_86adb8ef9ae94f3925234bc0588b33f7` failed after 1.4 seconds. Host Codex recorded `usage_limit_exceeded` with zero credit balance; Lervo recorded only `provider_turn_failed` with unavailable usage. That receipt made every later owner reservation exceed the epoch.

Four more attempt-2 decisions (8681–8687) were recorded, each reserving 100,000 tokens. Each missed its 120-second plan deadline before the execution-time spend check; three were superseded and the fourth stopped by `preflight.blocked` at 8688. Supervision then reported `supervision_owner_spend_exceeded`; no second provider turn started.

The source fix classifies the usage limit, stops owner retries after it, and checks headroom before recording a proposal. The deadline miss was later measured on an isolated copy of Kael's repository state.

Commit `41e206eb` was built as verified Linux Node r77 `sha256:b91becc87f2fe2cc07a181ea30769cb0cb1134df3968d311e19ccd7ed8cc86a3` and installed through the protected upgrade; Hub remained r67. Node PID `1429784` was active with zero restarts and an exactly matching definition. Five minutes later, conversation and sync were ready, head remained 8689, and supervision reported `preflight_repair_requires_review`. No new owner decision, reservation, or provider start occurred. The unresolved barrier stops before proposal, so only source tests prove the new usage-limit and proposal-time spend paths at this point.

## Fact reconstruction and r78

An isolated read-only copy of Kael's repository state was profiled with `41e206eb` sources at load average 4–5. Owner-reasoning fact reconstruction took 5.4 seconds; about 5.5 seconds was serial Git inspection of 38 retained, never-used worker checkouts at roughly 145 ms each.

A supervision cycle rebuilds facts during proposal, admission, native readiness, owner-control readiness, and execution revalidation. Five or six rebuilds plus contention in the busy Node account for the 93-second gap from decision recording to readiness. Bounded parallel inspection, four at a time with input order preserved, reduced reconstruction to 2.3–2.5 seconds on the same copy. The checkouts remained; removal required separate write authority.

Commit `151d1b1f` was installed as verified Linux Node r78 `sha256:f0329383b747970533cee0601d2367f7b54f35b6c743210bc44962912e795ef4` through the protected upgrade. PID `1500738` was active with zero restarts and a matching definition. At 12:48Z, conversation and sync were ready, head remained 8689, and supervision reported `preflight_repair_requires_review`. Faster fact reconstruction had not yet run in a live supervision cycle.
