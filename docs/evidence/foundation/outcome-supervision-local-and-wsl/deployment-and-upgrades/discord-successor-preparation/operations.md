# Host CPU, boot activation, and morning incident

## Host processor observations and budget

At 22:53 KST with WSL up 20 hours, Windows processor load was 25%; `vmmemWSL` accumulated about 131,600 processor-seconds, averaging 1.8 cores. `dwm`, `System`, `SearchIndexer`, and `MsMpEng` were an order of magnitude smaller. WSL load averaged 2.5. Two five-second `top` samples attributed nearly all load to Arca-next Compose: three `arca-next` processes and five uid-10001 `python` workers held 20–110 processor-minutes each. Instantaneous `docker stats` showed `arca-next-nine-axis` 21%, `arca-next-demo-matched-sizing` 14%, `arca-next-continuous-history` 10%, and `arca-next-continuous-market-expanded` 7% of a core; `dockerd` had 10 processor-minutes. Seven Lervo Nodes, Hub, and forwarding proxy each used 15–413 processor-seconds over 20 hours. Lervo polling was well under 1% of guest load; sustained fan noise was attributed to Arca-next continuous containers.

At 16:10 UTC, all Lervo goals complete and scoped Node just restarted, the guest used 1.74 busy cores: Docker 0.81, scoped Node 0.09 during synchronization/first reasoning (0.002 per thread once idle), other six Nodes/Hub 0.000–0.009 each, remainder kernel/daemon overhead.

Arca-next had 30 always-on containers across four Compose projects: `~/arca-next/deploy/compose.yaml` with 25 services under `arca-next@jonghyeok`, plus three `~/arca-next-runtime` projects covering nine-axis, continuous history, expanded/shadow markets. Container `cpus` caps totaled 10.35 on a six-processor guest; busiest containers already saturated their caps.

The operating budget reduced deployment caps to 0.6 of prior values for market, liquidation, liquidity-recovery, materials, and microstructure, and to 0.3 for demo, growth, shadow, observatory, research, and backup. The recorded intermediate sum was 10.35→4.88. Compose backups used `.before-cpu-budget-20260915`; deployment containers were recreated with the unit's `docker compose up -d --no-build` and all were healthy.

Runtime recreation requires volume-root environment, so six runtime containers were capped in place via `docker update --cpus`: 0.08 for nine-axis/expanded market, 0.05 for history/shadow. These settings persist across daemon/guest restarts; Compose files also carry them for recreation. Final whole-guest cap sum was 4.76 cores.

Post-budget completed-goal measurements: Windows `vmmemWSL` averaged 1.81 cores over a minute, total host 24%; guest approximately 1.9 busy cores (user 1.43, system 0.22, softirq 0.43, steal 0); Docker 0.73; idle scoped Node 0.08–0.10 for five-second change loop, sixty-second authority audit, and Discord Gateway. The cap reduction 10.35→4.76 bounds peaks and throttles saturated containers, but continuous Arca-next demand below caps keeps the guest near 1.5–2 cores until experiments pause. Pausing ten `demo-*` containers could free about 0.35 core; that reversible choice was not taken. Scoped idle 0.1 core is a bounded loop follow-up, not an observed leak: threads approach zero between cycles.

## Boot activation

After every installed stage had been observed, `lervo-node-28de5803e2db5aec8bd4ee7d.service` was enabled for the user's default target at 16:15 UTC, using Node `b3a300543ef79ed73e71a4546a57288667e7a61e349a3e88588b2ae96b951a33` and next-installed supervision configuration. Lingering already supported six team Nodes.

Controlled `wsl --shutdown` occurred at 01:25:06 KST. First Ubuntu command answered 4.8 seconds after the start request; all nine units (seven Nodes, Hub, forwarding proxy) were `active running` within ten seconds of boot. Scoped process began 01:25:25, sync began 01:25:57, and health showed ready `sync`/`conversation` with bounded `local_result_canonical` supervision on completed goal 17. Pre-shutdown health persisted on disk until replaced about three minutes after boot.

Arca-next's timer fired, deployment was activating with 29 containers up, and runtime caps survived (nine-axis 0.08, history 0.05). Scoped boot startup required no operator action.

## Morning incident, 2026-09-15

At 06:00–06:04 KST, Discord messages received generic failure. Journals identified three independent causes, separate from the supervised journeys:

- Elio still used acceptance supervision configuration after seventeenth-mandate expiry at 18:00 UTC. Configured supervision routes every work-intent message to the supervised responder, which refused `supervision_authority_unavailable`. Service switched to ordinary `lervo-node-config.native-po.json` (Tarin/Elio, no outcome supervision) on current Node; conversation became ready. At that time production `/goal` required one operator-installed mandate per goal, so ordinary routing was the standing configuration until a standing-goal loop existed.
- Kael's arca-next and flemo Nodes refused `repository_replica_not_ready`. Divergence dated from September 12 for arca-next (Mac `95785ef`, `main`; WSL `22f8d20a2`, “feat: checkpoint autonomous Arca runtime”; neither commit on the other side) and September 13 for flemo (Mac `3cbbbe75`, `docs/agent-facing-declarations`; WSL `63ea09f5b`, `main`). Mac `dev.lervo.repository-replica` logged divergence every cycle. Owner merge decisions were not forced. Instead, `repositoryReplica` requirements were removed from both configurations, with `.before-replica-optional-20260915` backups; runtime rejects `required: false`. Both Nodes became ready and bots could use WSL without awaiting Mac mirrors.
- Lervo divergence came from extracted archives and macOS resource forks atop an older WSL head. Tracked modifications were stashed as `wsl-tracked-modifications-20260915`, untracked files cleaned, and Mac snapshot adopted with replica CLI. Coordinator recorded reconciliation at 21:19:44 UTC.

Axli and shiflo each logged one transient Gateway `connection_failed` following an unplanned 04:01 KST guest restart, distinct from the controlled restart about three hours earlier.
