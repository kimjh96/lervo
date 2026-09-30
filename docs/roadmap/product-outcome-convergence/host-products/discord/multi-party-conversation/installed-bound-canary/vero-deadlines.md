# 2026-09-20 active Vero turn deadline correction

## Active-turn failure

Vero owned human `#axli` message `1551102226771083316` at `05:26:28.948Z` and selected `continue_work` on Codex `gpt-5.6-terra`. Native work began at `05:26:42.853Z`, ran 30 minutes, and ended once with `provider_turn_timeout`. Vero delivered terminal failure message `1551109864426704977`.

The provider was not idle: its local record contains 147 item/turn progress events, with a longest observed gap of 141 seconds. It edited and verified AXLI planar surface-role work and advanced the workstream to active revision 241 immediately before the deadline. The checkpoint and repository bytes remain, but the provider never returned a final result to the Node; the native work row remains failed and completion cannot be inferred.

After rollout, the original inbox and work rows still had one attempt and the failure outbox remained delivered once. No historical request was replayed.

## Deadline contract

Native provider adapters now treat the configured 30-minute value as a no-progress limit renewed only by structured Codex or Claude stream events. A separate absolute limit is three times that value, capped at 90 minutes.

Commentary, a zero exit after termination, arbitrary stderr, and process liveness remain insufficient for completion or progress. The existing earlier finalization instruction still asks the agent to stop new work before the old 30-minute boundary. The longer absolute limit supplies completion headroom, not unlimited work. Both adapters retain `provider_turn_timeout` if either limit expires.

## Validation

Focused contract and adapter tests passed 8/8 on Mac and WSL, including active turns extending beyond the inactivity window and deadline termination after an intermediate message.

The first full Mac run passed 3,898 tests and exposed 12 unrelated timing or changing-metadata failures. After refreshing the derived CLI manifest and SBOM, affected metadata and timing tests passed focused reruns. The stable second full run passed 3,909 tests with eight conditional skips and one unrelated 120-second supervision-standing timeout; that file passed 5/5 alone.

Typecheck, build, quality, documentation, release-manifest, SBOM, and knowledge lint passed. Knowledge lint retained pre-existing non-error findings.

## r39 installation and remaining acceptance

Linux Node distribution `sha256:4c64a464e47d8e341f513ceacc5b75420dfe9b95b0a9d06ed516bc8b5e773d27` (`runtime-4c64a464-r39`) was archive-verified and installed immutably. CLI bundle `sha256:f7ec53839558a8188e2904ea98a3517f3ef4ee38a492aa030c95c54eddbd759a` (`settled-f7ec5383-r39`) was installed on WSL and Mac.

Seven owner-only configuration candidates bound that exact CLI and passed new runtime preflight. Exact predecessor service definitions remain available for rollback. AXLI was upgraded first, then Elio, Shiflo, Plen, Flemo, Arca-next, and Digimon.

Final inspection found all seven active on r39 with zero restarts, matching health/systemd PIDs, and conversation and sync `ready`. Six were overall `ready`; AXLI supervision remained separately `degraded` because of its existing budget limit. The selected Elio review stayed active at revision 2 with approval unchanged.

No fresh human Vero turn appeared after r39, so installed human-message completion remains open. The 128-item release-intent bound still yields `intent_pending`; operational installation is not a reviewed CLI release.
