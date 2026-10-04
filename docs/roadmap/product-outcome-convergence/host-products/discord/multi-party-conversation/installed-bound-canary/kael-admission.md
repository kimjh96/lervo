# 2026-09-23 Kael sparse-workstream admission recovery

## Failure and canonical-history boundary

Three recent human-authored Kael requests selected `supervision_goal_request` with provider-observed `gpt-6-sol`. Each ended with `response_effect_unconfirmed` after the installed responder raised `supervision_admission_unconfirmed`.

Read-only bound authority and task reads reproduced the cause: the Arca-next WSL event journal has revisions 1–162, a `hub_replication_import` at 185, then contiguous local revisions through 323. Hub replication intentionally transferred the exact head without revisions 163–184. The supervisor rejected this valid sparse checkpoint because it assumed contiguous local history.

The Mac journal contains the missing snapshots, but its later branch cannot substitute for subsequent canonical WSL work. No historical event or failed inbox row was rewritten or replayed.

## Correction and validation

Commit `a74ddda2f93728cdecabeda96b6de430126ce3b3` allows the bound reader to accept only an artifact-verified sparse Hub checkpoint. Unexplained gaps and broken subsequent predecessor links still fail.

All 24 focused supervision, response, and revision-reader tests passed, as did typecheck, Node build/smoke, quality, documentation, knowledge lint with zero errors, and base-bound release completion (`intent_pending`). Actual WSL revision-185 and revision-323 CAS artifacts matched their recorded workstream identity, revision, and status. With the corrected WSL build, authority and task reads succeeded at revision 323 before service activation.

## r54 recovery and open acceptance

Linux Node distribution `sha256:45f91fc5a82a50345c2859a6e3670a84ad0e99018c2e1f140725b24bd8b427a7` (`runtime-45f91fc5-r54`) was archive-verified, installed immutably, and preflighted against Kael's unchanged owner-only configuration. The exact r53 definition remains owner-only for rollback.

Only Arca-next/Kael was upgraded. Process `2407622` ran r54 with zero restarts. At `2026-09-23T09:24:33.972Z`, conversation, synchronization, workstream replication, and remote control were `ready`; overall status was `ready`. Supervision was explicitly `dormant` with `workstream_inactive` because no new goal was bound.

This proves historical source-read and service recovery, not a new post-upgrade human request, goal admission, supervised execution, or Discord result publication. Those remain installed acceptance checks. The separate held multi-party approval is unchanged.
