# Standing lineage and first two successors

## Reviewed standing grant

ADR-0405, linked from the entrypoint, replaced the incident's per-goal operator transition with a reviewed standing grant. On 2026-09-15 WSL rebuilt revision `27565796` as Node `3f297434` and CLI `d4065184`. First start failed by reparsing normalized configuration; revision `2ff364fc`, Node `b8db51b1`, fixed it.

With scoped service stopped, root `wks_4743fd1e31b849d833fa918b` was started. Root `mandate.discord.standing`, supervision `supervision.discord.standing`, hash `0f85d344…`, was planned/installed with seventeenth-mandate exact ceilings, `successorAuthority.maximumSuccessors` 64, and expiry 2026-12-14. Root completed at revision 2 so each request starts its own goal. `standing-node-config.json` combines ordinary product-owner configuration and `outcomeSupervision.standing`; Elio/Tarin ordinary conversations retain repository-work routing.

First local intake at 01:20:35 UTC bound in nine seconds without an operator step: successor `wks_c6ec8449b767fbc1afb123b3` snapshot at 01:20:39/event 16721, origin `successor`, objective equal to request; installation `supervision.discord.standing.s1`/`mandate.discord.standing.s1`, hash `9abeb8e9…`, at 01:20:41/16722; binding 01:20:44/16723. Service started 01:20:48, resolved `.s1`, reasoned, allocated/dispatched the qualified researcher, passed verification 01:26:46, and returned rework 01:28:14 under derived authority.

## Stalled never-bound rework claim

At 01:29:47, assignment `asn_55c5418a…` reopened at revision 3/attempt 2. A 01:29:59 successor duty had a 154-second completion window ending 01:32:32. Automatic recovery reserved a 150-second lease behind a five-second admission margin. Rechecking at 01:30:04 left insufficient time; acquisition wrote nothing and effect 16878 became `uncertain`, without effect events.

Cycles failed on that claim until 01:32:30. After deadline every cycle reported `pending_decision_requires_reconciliation`, because responsibility claims lacked supersession; attention persisted at 01:38/01:44 without new events. Revision `263691b4`/ADR-0406 supersedes never-bound claims, expands admission margin to thirty seconds, and floors owner completion windows at ten minutes.

Node `21588dc6` and CLI `689326a0` started on the same goal at 01:59:39. First cycle superseded the claim at 02:00:18/event 16879, with absence inspection in CAS and no manual repair. Owner reasoned 02:00:36 and confirmed its next effect 02:01:32, continuing under the same derived mandate.

## Ceilings, rebinding, and cancellation

Successor 1 exhausted two attempts and escalated `retry_budget_requires_resolution` at 02:16:16 and 02:19:26. The owner agent raised attempts to contract maximum four in `.s1` version 2: approval `sha256:e16bb224…`, mandate `sha256:f3198ea7…`, installed 03:52 while stopped. Owner resumed immediately, claimed a fourth attempt, and passed verification 03:58:34.

Accounted tokens then reached 1,039,729 against 1,000,000. Version 3 raised aggregate to 1,300,000: approval `sha256:8192a146…`, mandate `sha256:04082464…`, installed 04:02:54 while running. Runtime pinned its old hash and failed all later cycles with `supervision_binding_invalid` until restart. Revision `ab04f335` watches current supervision as well as next successor and rebinds on installation-hash changes, allowing ceiling changes without stopping the owner.

The goal still did not finish. Redeployment restarted the parent during `run_7562552f`, after `adapter.started`/`context.injected` but before terminal or usage. A started run cannot use absence supersession, so its one concurrency slot stayed occupied. No further decision was admitted; `concurrency_exceeded`, `resource_unobserved`, and `usage_unobserved` persisted through two restarts and lease expiry 04:15:24. Goal revision 2 was cancelled with that cause after 1,181,287 accounted tokens across five rework rounds. Bounded orphan-run settlement remained open at this point.

## Second successor without interruption

A second request was admitted at 04:26:59 while service remained running. Successor `wks_7273c4ceb28b001c077bfec1` recorded 04:27:04 with origin `successor`; `supervision.discord.standing.s2` installed 04:27:06; binding followed 04:27:10. Health returned ready; main process 907204 remained unchanged with zero restarts. Standing intake created the second goal without an operator step or interruption.
