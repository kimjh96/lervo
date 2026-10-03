# Lervo retries and acceptance

## Request polling and first r161 attempts

The three-document apply rolled back at event 53530 after `ver_2e73a4d7e3413783` failed shard two. Preparation, lint, typecheck, and shard one passed. Shard two passed 1,081 tests across 217 passing files, with one failing file: `apps/conversation/test/discord-remote-continuation.test.ts` asserted before its request mock was called after silent 100 × 1 ms polling. Shards three/four were unrun.

The fixture now waits up to eight seconds for actual request/publication and explicitly fails if unmet. Both focused tests passed on Mac/WSL under a 15-second test deadline. Three task-source tests also passed on WSL, including unrelated background assignment. Mac quality/base-bound release completion passed; release remained `intent_pending` across 399 changed paths.

Three exact source files reached WSL, advancing the private ref to `66d544bbe3019c6a51003e9ba0ce9db6b744df71`. The Linux r161 archive, `sha256:9dd8af07c402dfd72ed208529230cf556d220002c87aa7ef8ac9eddac0c87f87`, was verified, installed immutably, and passed preflight. The first guarded upgrade refused `service_upgrade_supervision_busy`, retaining r160; r161 activation/full apply remained unobserved.

## Transfer failure, migration plan, and concurrent writes

The next apply failed repository lint before tests at event 53933. Mac transfer had added three AppleDouble `._*` files alongside TypeScript; `ver_fc3e506fd62cb0eb` identified all three parse errors. Exact removal on WSL restored passing `pnpm lint`. The worker resumed assessment/integration without a successful retried apply yet. Repeated r161 upgrades refused `service_upgrade_supervision_busy` or `service_upgrade_work_busy`, retaining r160.

A live Discord turn separately failed `unmanaged_change_detected` when normalization changed managed files in the shared checkout. Whole-repository comparison cannot safely attribute this overlap; installed conversation acceptance remained open.

Shiflo workstream revision 369 and Lervo Mac revision 141 recorded remaining gates. On Mac, `lervo migrate knowledge --json` produced ready plan `kplan_24fdc2c37b76c1f0acf822af` with complete coverage; `lervo knowledge lint --json` returned `valid: true`. The plan was inspected, not applied while WSL owned live convergence. Mac lifecycle passed 479 documents; task-base release completion remained `intent_pending` across 399 paths. Another r161 upgrade refused `service_upgrade_supervision_busy`.

At 04:19 UTC, Lervo had passed review and entered apply verification; corrected Shiflo sources continued review/integration. Neither had a new lifecycle completion receipt. Lervo apply was still verifying at 04:39 UTC.

## Organization-test timeout

Lervo rolled back at 54622. `ver_94dc8c3efd2487f2` passed preparation, lint, typecheck, and shards one/two. Shard three had 217 passing files, 1,275 passing tests, and one 15-second timeout in `apps/cli/test/agent-organization-command.test.ts`.

The case combined 1,001 historical events with repeated runtime binding, identity, credential rotation, and roles. It was split into bounded event-page replay and runtime-change cases without production changes or deadline increases. Both files passed on Mac/WSL, four tests total; WSL replay took 5.848 seconds.

Mac quality and the 479-document lifecycle passed; release remained `intent_pending` across 401 paths. Exact hashes matched, and the WSL ref advanced to `e443a6779a6156e79dddd926db464e49560245f8`. Baseline was requested at 54707; assessment completed at 54712. A new installed four-shard apply, lifecycle completion, and full currency remained unobserved at that point.

## Transaction attribution and upgrade boundary

Live-turn `unmanaged_change.detected` event 53523 named five normalization records and three conversation decision documents overlapping the transaction later rolled back at 53530. Those bytes never became a verified committed outcome; trusting the paths during conversation would hide a real revision change. Snapshot rejection remains correct under the current contract. Live concurrency needs transaction separation or coordination.

The r161 SHA-256 was rechecked before another guarded attempt, which again refused `service_upgrade_supervision_busy` and retained r160.

## Latest installed apply

Retried normalization reached current at 55209 after `ver_a4cbdf64b587700b` passed isolated preparation, lint, typecheck, and all four risk-based shards. Shard three included the split organization tests. The reviewed transaction normalized three conversation decisions; the next generation queued at 55210.

Verified repository revision: `sha256:20993f0bf3ee5d0170eafaa492ebf44526b9532c160b02b3565b2641821fb6e8`.

This establishes one successful batch. Baseline still lists 211 normalizations and three lifecycle reasons; repository-wide currency and live-conversation acceptance remain unproven.
