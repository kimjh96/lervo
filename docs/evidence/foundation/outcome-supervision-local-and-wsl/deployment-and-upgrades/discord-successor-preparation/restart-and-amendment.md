# Restart and requirement amendments

## Restart after workspace preparation

Tenth goal `wks_d5872698bb5ce080e2ee2b89` started 14544 under `supervision.discord.acceptance.next10`, approval `sha256:e3c435ea1bbe1aadf7ac8161ec77f65ef9c18e52be4bebadff38e428d7fa41c0`, mandate `sha256:42ce96fb24f0ce00e730c9a63be546cc17ebcca1105193fbf447444fff3da157`; identical local request bound 14546.

`systemctl --user stop` one second after `assignment.claimed` (14581) allowed in-flight workspace preparation to finish 21 seconds later (14585). Graceful stop cannot separate claim from workspace; it stopped between `work.supervision.workspace.prepared` and dispatch. Restart dispatched existing assignment once at 14587 (`osd_2cdf40f52dc9f549417bbac7`), without second allocation, claim, workspace, or hire. Renewal 14621, verification 14628, acceptance 14699, and revision-2 completion 14732 followed. This proves that specific installed restart point.

Completed local goals 7, 9, and 10 reported `owner_plan_unavailable`: native owner returns no plan for `publish_result` without a bound external origin. Canonical local results need no publication; the misleading attention was a presentation gap, not lost results.

## Live-lease amendment failure

Eleventh goal `wks_dc38f6cc01901735c4936a04` started 14734 under `supervision.discord.acceptance.next11`, approval `sha256:5b293ca35673fff8f9e1ae706c4f0290539f38e9313e929c6fab7645da196922`, mandate `sha256:23f2b1d697bc126a8c9dac951c69d3cd7e9f066b618162428ab577f698466d0b`; same request bound locally 14736.

A watcher polling the store every 100 ms sent `SIGKILL` 142.7 seconds after restart, about one second after claim 14771 and `work.responsibility.bound` 14772, before effect observation or workspace. Systemd reported `Result=signal` and automatically restarted. User actor revised criteria at workstream revision 2 while the assignment was claimed, unstarted, and workspace-free.

About 30 seconds later automatic restart reconciled the claim at 14774. Under “revise only an expired or absent lease with no prior execution,” owner continued the live five-minute lease, prepared 14776, dispatched original responsibility 14778, accepted 14890, and completed 14923 against old criteria. Neither review nor completion rechecked the changed objective; output lacked the added fully-or-partially statement and 700-word bound. Scenario 9 remained open for live unstarted leases.

## Versioned amendment after expiry and review-driven rework

Twelfth goal `wks_a1a3a7b5d77101353d74382d`, `supervision.discord.acceptance.next12`, approval `sha256:51ece01126ca616c039628f267f820d5b682c4f2fb08e0e856a3812f74a2580e`, mandate `sha256:95d6d41967146cf8d6fec03cb8ed78847c8f8bed0848563a86762ad964fe96aa`, bound identical text locally. Watcher killed one second after claim 14962 (recorded lease `asn_88a363ebe118b25d7d219342`, generation 1, expiry 13:13:16 UTC), then stopped the service to prevent restart.

User revision 2 at 14964/13:08:33 required each promise to say whether its criterion tests it fully or partially, in fewer than 700 words. Starting after expiry at 13:13:26 reconciled the claim 14965. Owner reasoned once and proposed `revise_responsibility`: `assignment.amended` 14997/revision 3 linked predecessor `sha256:75cfa6dc3dad17ce0082eb570c12ef306025acece23e2123d548f258fb30e26d`; another `revise_responsibility` claimed generation 2 at 15000/revision 4. Workspace 15004, dispatch 15006, verification 15047 followed.

Review requested `rework` at 15084 for artifact `sha256:40802777a180001fcdb069424d438717170f4746febcf3040150daf62b956007`. Rework request 15116, reopen 15117/revision 5, generation-3 responsibility 15120/revision 6, second workspace 15124, dispatch 15126, and passing verification 15166 followed. First revised brief already met amended criteria: 503 words and fully/partially per promise. Rework instead found `research.claim-support` (read-only execution lacked independent run-bound evidence) and `plain_audience_language` (unexplained “pinned artifact”), exercising scenario 6.

Second artifact `sha256:1c268698e829f8222875ae4be941fc52af71ced385dcf9d3a37549d58d137e6c`, 563 words with per-promise assessment, was accepted 15237; revision 3 completed 15270. This proved installed expired-unstarted-lease amendment, successor claim, review rework, and revised-criteria acceptance after actual process kill. The active completed-goal service remained boot-disabled with `owner_plan_unavailable`; live-lease amendment and installed `origin_conflict` still blocked boot activation.

## Corrected live-lease boundary

Mac revision `ae18dfa9` adds goal revision to responsibility bindings. Native dispatch refuses workspace preparation/dispatch under an older revision; owner facts expose `staleResponsibilities` for escalation while live and revision after expiry. WSL Node `0846dc4e0da2902340d9bc4d5a682451292fe98c64f04505abccb68c8e5892b6` required rebuilding `@lervo/agent-workforce` first to expose the field, then deployed on completed goal 12. Unit tests proved correction; installed observation was still pending then. Pre-existing Mac `supervision-native-completion` cases `late_completion`/`late_recovery` failed with and without this revision, independently of the change.

Thirteenth goal `wks_dbcf5f1355dbe3a221e6ee3f`, `supervision.discord.acceptance.next13`, mandate `sha256:b6975ad74ebfe0334e9854e6aa857226c60524700b5c2aea5bf3d33e3754426c`, bound locally 15274 on `0846dc4e`. Watcher killed one second after claim 15309, lease expiry 13:58:08; user revised at revision 2/15312/13:53:16; service restarted 13:53:42 with lease live.

The killed owner's fence persisted until about 13:57. First reasoning at 13:57:54, with fourteen seconds of lease remaining, read `facts.staleResponsibilities` and escalated `goal_revised_lease_pending`, explicitly withholding workspace/dispatch until canonical expiry; result `sha256:4debfc6d569c776a8a605627e9f406e5b3ceedf00eeec7b982375e91a6fc33e0`. At 13:58:51 it observed expiry and proposed revised per-promise/700-word responsibility, result `sha256:4c2d71f5fa60b75d19d570a00beca806efafdc1b8a00f00c57ed543781a92e37`.

Amendment 15374 at 14:00:00, generation-2 claim 15377, and revised execution followed. Review/rework 15461/15493, generation-3 revision 15497, second verification 15543, acceptance 15614, and revision-3 completion 15647 finished the goal. No stale-responsibility workspace or dispatch was recorded. Scenario 9 was now installed-proven for a live unstarted lease. Restart-to-first-cycle delay came from the killed process's five-minute owner fence, not a lease-expiry wake.

Node `4b5360096605cd4afdd6d57e010afdbfed2bf7a34aed4b1bcbf9dbf89d03e4aa`, revision `f174370d`, replaced it on completed goal 13. Health now says `local_result_canonical`; service remained manually started and boot-disabled.
