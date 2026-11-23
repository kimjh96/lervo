# 2026-09-23 Shiflo webhook-control correction

## Observed failure

Read-only inspection of Shiflo interaction stores found twelve `attention_required` outbounds after three `adapter_delivery_failed` attempts: five Sora and seven Nuri. All carried `observe_only`; nine also carried `task.result`. None had a platform replay row. The current webhook adapter's pre-replay attribute rejection explains the failure without claiming an unavailable historical exception stack.

An exact-content-hash poll of the observed channel window found no matching publication. This absence is neither a verified delivery receipt nor permission to resend. All twelve rows remain unchanged.

## Correction and validation

Commit `fe023951ee` applies ADR-0629, linked from the [scope entrypoint](../installed-scope.md):

- Unaddressed webhook ingress is observation-only.
- Safe unaddressed webhook status and co-resident task-result text may publish without pretending the webhook carries task control.
- A remote task whose source or target cannot carry the bot nonce is rejected before assignment publication.

Focused adapter, platform, delegation, and co-resident router tests passed 42/42 on Mac and WSL. Typecheck, quality, documentation, build, release-manifest, and SBOM checks passed.

The full Mac suite did not pass: its initial 3,955-pass run had generated-metadata mismatches, a no-suite test file, and timing/file-watch failures. Metadata tests passed after regeneration; two wakeup tests still failed in isolated reruns. Release completion is `intent_pending`, not a published release.

## Shiflo-only r55 deployment

Linux Node distribution `sha256:9b7715bdcc4a74813ad42f6d244d44939d193a5a8d4c45e40e99dcc90e53b2c7` (`runtime-9b7715bd-r55`) was archive-verified, installed immutably, and preflighted against unchanged Shiflo configuration.

Only Shiflo service `nfi_2bbef9a417cbc00263593a8d` upgraded from r53. Its exact r53 definition remains in the owner-only `webhook-control-r55` acceptance directory. The rendered definition changed only the runtime executable and private path.

Post-upgrade systemd reported active/running, main PID `2480478`, and zero restarts. The owner-only health snapshot matched that PID and reported ready aggregate, conversation, sync, workstream replication, and remote control. Supervision separately reported `dormant:workstream_inactive`.

## Acceptance remains open

No new human-authored Shiflo turn has proved visible webhook publication and exact coordinator continuation after r55. The historical five-plus-seven attention rows remain unresolved. The two-direction normal/redelivery/failure/retry/restart matrix remains required before technical acceptance closes. The owner's earlier authorization is not a missing-consent blocker.
