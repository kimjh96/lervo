# 2026-09-19 fleet deployment and supervision recovery

## Initial fleet deployment

The first shared-worktree Node snapshot, immutable Linux distribution `sha256:9167ed156c011c2dcf0170de3b53af00d7ecbf0eddf2f856e90c621f07304c98`, was transactionally installed on all seven WSL Node services: Axli, Shiflo, Plen, Flemo, Arca, Digimon, and the acceptance canary. All service definitions referenced that distribution; every service was active with health PID equal to systemd main PID.

Matching CLI bundle `sha256:8be52e3c57547edcadfad11a44e6d54834e7d2b57042a416a26312c7f93f72b8` was installed at a new immutable path. All seven configurations passed preflight with it. Prior service definitions and CLI configurations remain available for rollback.

Changed shared schema and event-contract dependencies also required Hub distribution `sha256:0381dc64939d848fb666fc32becb87737aa91fa35a21e26f536bae4a85ae7d71`. Eleven accumulated systemd drop-ins still overrode the new managed main unit; their only active settings were historical `ExecStart` replacements. The whole drop-in directory was moved to owner-only rollback staging before daemon reload and restart. The observed process then ran the new Hub distribution; `/v1/health/ready` returned HTTP 200.

Shiflo, Plen, Flemo, Arca, and Digimon were overall `ready`, with sync, workstream replication, remote control, and conversation ready. Axli had the same four ready components but was overall `degraded` because supervision reported `aggregate_budget_exceeded`; this was not supervision-readiness success.

The canary initially reported sync and workstream replication `hub_unavailable`; controlled rollback to the prior Node reproduced it. After Hub upgrade both became ready, but standing supervision remained `pending` and overall health `starting` at the last observation. These checks establish process/component health, not the human-authored conversation matrix or a new user-requested runtime action.

## Explicit-model supervision recovery

The founder approved one additional million tokens for AXLI's existing standing mandate. Reviewed version-2 installation event `evt_f187ac6a4426fc3f1165e648f15ba47c` raised the cumulative ceiling from 1,000,000 to 2,000,000, preserving exact owner, workstream, paths, capabilities, provider, host, expiry, and attempt limits. Historical usage was not reset.

The next AXLI cycle exposed separate `usage_unobserved`: 18 complete Astra runs reported 942,313 tokens and one complete Sol run 64,942; descriptors differed only in requested model. ADR-0422, linked from the [scope entrypoint](../installed-scope.md), permits a narrowly proven explicit-model migration sum. Read-only inspection of installed canonical events and CAS descriptors derived exactly 1,007,255 tokens across all 19 runs.

Node distribution `sha256:5993ff78e0590c9d8a1790fefbd54bc27443c9ab6ec32048bed36dfeec0abbb7` and CLI bundle `sha256:fee8b41e2fb862236b88e70ba60bf0f9d7ca2c108be2b20e1606394a6b8fe6e1` replaced the first snapshot on all seven services. Every configuration passed preflight. All six product-owner Nodes were overall `ready`, including AXLI supervision; the Hub remained ready on its current distribution.

The acceptance canary's conversation, sync, workstream replication, and remote control were ready. Standing supervision stayed `pending`: latest installed standing-lineage workstream `wks_57cba9746df356647c1d72e3` differs from active review workstream `wks_595331423aaba2b1e67cacfe`. The review's operational approval remained pending; deployment neither completed nor rebound it. Canary aggregate health therefore remained `starting`, an installed coordination limit rather than universal readiness.

Focused pure budget tests passed on Mac and WSL; typecheck and quality checks passed; installed AXLI supervision reached ready. The wider Mac supervision suite had environment-dependent native-runtime readiness failures and timeouts and is not passing acceptance. Human-authored Vero preview open/close and the held two-direction matrix remained unfinished.

## Dormant-canary readiness correction

Elio owns the canary's standing supervision. Its bound lineage remains separate from the current conversation-routing review and pending operational deployment approval. Under ADR-0405, linked from the [scope entrypoint](../installed-scope.md), this is intentional owner inactivity, not unfinished process startup.

Health now reports `supervision: dormant` with fixed `reasonCode: workstream_inactive`; aggregate readiness may be `ready` when conversation, sync, workstream replication, and remote control are ready. Fleet reports expose conversation and supervision separately so aggregate readiness cannot imply an executing goal. Other supervision failures remain `unavailable`. Only the exact typed inactive-workstream error is dormant; an unrelated exception carrying the same code stays unavailable.

Validation passed: health/failure-mapping tests 12/12 on Mac and WSL, standing-lineage/change-loop tests 6/6 on Mac, typecheck, quality, and documentation checks. Linux Node distribution `sha256:931da383f8b7a89d0a00438ad93b8bb4d8868acc61471d100365764eee83f802` passed all seven configuration preflights and was transactionally activated first on the canary, then the six product-owner Nodes.

The matching CLI bundle's `dist/bin.js` SHA-256 was `75662fc40c4677e1ba60a1ea15f1d3719ffd31f1bbade4d09334f1f11d85d5cf`. All seven owner-only CLI bindings were backed up, changed to its immutable installation, preflighted, and restarted.

All services stayed active with matching health/systemd PIDs. All seven runtime snapshots and the fleet report were overall `ready`; the canary's conversation/sync/workstream replication/remote control were `ready`, supervision `dormant:workstream_inactive`. Hub readiness remained HTTP 200.

The held review stayed active at revision 2 with approval `wapr_e4cd367a01b02a4f`. Neither review, installed mandate, Discord agent identity, nor bot connection was replaced. The correction removes misleading perpetual `starting`; it does not establish resumed supervision or passed conversation acceptance.
