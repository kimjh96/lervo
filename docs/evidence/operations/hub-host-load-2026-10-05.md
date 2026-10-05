# Hub host load measurement, 2026-10-05

Status: `recorded`

Read-only measurements of Hub host `DESKTOP-DBI4M8F` (AMD Ryzen 5 7500F 6c/12t, Windows 10.0.26200, WSL 2.7.12, `processors=6`, `memory=12GB`), taken 02:18–02:50 KST on 2026-10-05. Steady-state figures start at 02:33 KST, after `lervo-build-25d1abc9` and six Node restarts finished. Nothing on the host was changed during measurement. This is the evidence base for [ADR-0461](../../decisions/operations/services/0461-drive-resident-runtime-service-work-from-changes-not-timers.md).

## Method

- Windows: `Get-Process` `TotalProcessorTime` deltas over 30 s; `Get-Counter` on `\Processor Information(_Total)\% Processor Performance`, `% Processor Utility`, and `\Processor(_Total)\% Processor Time` (6 × 5 s samples); `powercfg /getactivescheme`; `Get-MpPreference`; `Get-MpComputerStatus`; `%USERPROFILE%\.wslconfig`.
- WSL: `/proc/stat` and per-process `utime+stime` deltas from `/proc/<pid>/stat` over 60 s, grouped by `/proc/<pid>/cgroup` and command; new PIDs sampled every 0.2 s, retaining CPU ticks at last sighting for short-lived processes; per-thread deltas from `/proc/<pid>/task/*/stat`; `/proc/<pid>/io` deltas; 1 s per-process CPU series for 150 s; `/proc/<pid>/fd` sampling every 50 ms for 30 s; `systemd-cgtop`; `journalctl --user`; read-only `node:sqlite` queries against `.lervo/data/events.sqlite`.
- `ptrace_scope=1` prevented `strace`; no inspector was attached. Argo processes were only observed.

## Windows

| Observation | Value |
| --- | --- |
| `vmmemWSL` CPU, 30 s delta | 547 % of one logical processor; 11.8 GB working set |
| `System` (Hyper-V partner) | 32 % |
| Next processes | Battle.net 4 + 2.3 + 0.9, `MsMpEng` 2.3, Steam ~1 |
| `% Processor Time` / `% Processor Utility` | 52–57 % / 71–80 % |
| `% Processor Performance` / nominal frequency | 132 % / 3,701 MHz; boost engaged, owner sees ≥ 4,000 |
| Power plan | Balanced (`381b4222-f694-41f0-9685-ff5bb260df2e`) |
| Defender | Real-time on; no path or process exclusions |
| Context switches | 60,000–76,000/s |
| Docker | One container, `Exited (255) 12 days ago`; daemon idle |

## WSL steady state: 02:33:51–02:34:51 KST, 60 s

`/proc/stat`: 33,568 busy ticks of 37,300 = 90 % of six vCPUs = 559 % of one core; load average 8.3. Per-process CPU below is a percentage of one core.

| Process | CPU |
| --- | ---: |
| `knowledge-worker --root ~/lervo` (unit 28de…) | 88.3 |
| `argo4.learn bootstrap` (python, torch; `init.scope`) | 82.5 |
| `knowledge-worker --root ~/teams/shiflo` (2bbe…) | 55.2 |
| Node main `--config … 28de…` (lervo, standing supervision + Discord) | 51.2 |
| `knowledge-worker --root ~/teams/digimon` (e23c…) | 29.0 |
| `knowledge-worker --root ~/teams/flemo` (4181…) | 22.2 |
| `knowledge-worker --root ~/teams/plen` (1f81…) | 21.7 |
| Node main `--config … abef…` (axli, standing supervision + Discord) | 18.5 |
| `knowledge-worker --root ~/teams/axli` (abef…) | 16.9 |
| `argo3.live.main` | 6.3 |
| Node mains 2bbe, 1f81, 4181, e23c | 5.5 |
| `argo3.collect.service` | 0.8 |
| `lervo-hub`, `systemd-socket-proxyd`, dockerd, containerd | 0.3 |
| Short-lived `repository-replica snapshot`/`receipt` (23 processes/min) | 60.7 |
| Short-lived `git -C ~/teams/digimon add -A` (3) | 2.6 |
| Measurement shells, udev | 6.1 |

Grouped CPU: knowledge residents 233.3, Node mains 75.2, replica polling 63.3, Argo 89.6, Hub 0.3, unattributed (sub-200 ms git children, kernel, softirq) about 91. Lervo total ≈ 372 % of one core = 62 % of the VM ≈ 31 % of the machine.

An earlier 60 s deployment window at 02:21 KST had the same shape: residents 192, Node mains 77, Argo 94, Hub 0.2; the remainder was `tsc`.

At the lervo Node unit stop at 02:27 KST, systemd reported `Consumed 1h 3min 19.288s CPU time over 51min 39.327s wall clock time, 2.1G memory peak`: 1.23 cores for one unit (main plus resident). The `stop-sigterm` timed out and the unit was `SIGKILL`ed, consistent with a resident never reaching an idle wait.

## Knowledge resident cycle shape

The 1 s CPU series contains 150 samples from 02:34:55–02:37:47, measured as a percentage of one core per process. Only burst windows are listed. Each resident runs one single-threaded burst per 60 s timer tick.

| Resident | Burst windows (start–end, length) | Duty |
| --- | --- | ---: |
| plen | 02:35:04–:21 (17 s), 02:36:03–:20 (17 s), 02:37:04–:20 (16 s) | 28 % |
| flemo | 02:35:28–:48 (20 s), 02:36:27–:45 (18 s), 02:37:27–:43 (16 s) | 30 % |
| digimon | 02:35:37–:56 (19 s), 02:36:36–:52 (16 s), 02:37:36–:47+ (11 s+) | 27 % |
| axli | 02:34:57–02:35:08 (11 s), 02:35:57–02:36:11 (14 s), 02:36:57–02:37:10 | 21 % |
| shiflo | 02:34:55–02:35:39 (44 s), 02:35:51–02:36:34 (43 s), 02:36:51–02:37:32 | 72 % |
| lervo | Continuous at 75–130 % for all 150 samples | 100 % |

Lervo resident thread split over 45 s: `node-MainThread` 67.0 %, four `libuv-worker` threads 1.8–2.0 % each, `node-V8Worker` 0.6–0.8 % each. `/proc/<pid>/io` over 45 s: `rchar` was digimon 2.59 GB, shiflo 757 MB, axli 361 MB, flemo 171 MB, lervo 146 MB (page cache hits for the rest); `syscr` was 80,000–220,000. Each resident held exactly one inotify descriptor and 26–27 fds.

Event stores at measurement time:

| Repository | Store observations |
| --- | --- |
| lervo | 60,168 events / 108 MB; last event `2026-10-04T02:36:57Z` (`repository.knowledge.stage.recorded`, `knowledge_authority_unavailable`) |
| axli | 24,745 events / 44 MB |
| shiflo | 22.7 MB; five `repository.knowledge.resolved` in six hours |
| flemo | 9.9 MB |
| plen | 6.0 MB |
| digimon | 1.8 MB; no events in six hours |

Repository file counts: lervo 6,914 tracked; shiflo 1,689 tracked + 129 untracked; flemo 854; plen 839 + 74; axli 9 + 1,885 untracked; digimon 0 + 637.

## Standing-supervision Node mains

Open-file sampling every 50 ms for 30 s showed repeated store reopening. A persistent handle appears 27 times per store because each sample lists all fds. Lervo main had 189 `events.sqlite` and 162 `events.sqlite-wal` sightings; axli main had 216 and 190. Other handles were Discord integration stores (`interactions.sqlite`, `intent-resolutions.sqlite`, at 54 = two integrations) and admission, policy, and replay stores at the 27 baseline.

Lervo main `rchar` over 20 s was 501 MB: 25 MB/s, approximately one full pass over the 108 MB store every 4–5 s. Axli main held 100–129 % of a core in 35–43 s stretches; lervo main did so in 12–17 s stretches every 30–60 s.

The four Node mains without standing supervision (`sync` only, idle poll 2,000 ms with Hub long-poll) used 0.4–3.0 % each; Hub used 0.2 %. `journalctl --user` for all Lervo units showed zero lines in the preceding ten minutes.

## Replica coordinator

Mac launchd `dev.lervo.repository-replica` runs `repository-replica reconcile --config ~/.lervo/repository-replica-coordinator.json --watch` with `pollIntervalMs: 30000`, `maximumConcurrency: 1`, and `peerWatch: false`. Its four replicas (flemo, plen, shiflo, digimon) were all `current` in `~/.lervo/state/repository-replicas.health.json`.

On WSL over 60 s, 8 `repository-replica snapshot`, 4 `repository-replica receipt` processes, and `/init` interop parents (46 sightings) used 61 % of one core. Over 45 s, 8 snapshots cost 1,307 ticks (29 %) and 4 receipts cost 525 ticks (12 %).

## Expected reduction and acceptance targets

| Cause | Before (% core) | Target |
| --- | ---: | ---: |
| Six knowledge residents | 233 | ≤ 12 |
| Six Node service mains | 75 | ≤ 6 |
| Replica coordinator polls | 63 | ≤ 4 |
| Lervo total | 372 | ≤ 22 |
| Argo (protected, unchanged) | 90 | 90 |
| VM busy (of 600) | 559 | ~115 |

Expected Windows reduction: `vmmemWSL` from 547 % to about 120 % of one logical processor; machine utilisation from 48 % to about 11 %.

Re-measure success using the same method:

- VM busy < 25 % over five minutes with Argo running.
- Each `knowledge-worker` < 3 % averaged over ten minutes and 0 % between cycles.
- Each standing main < 5 %, with under 10 MB/min read from `events.sqlite`.
- ≤ 1 `repository-replica snapshot` per replica per 10 minutes while Mac trees are unchanged.
- `% Processor Performance` ≤ 100 % averaged over five minutes.
- Owner-recorded temperature and fan speed below this baseline (≥ 60 °C, ≥ 2,000 RPM).

## Result after deploying `d78d6bf1`

ADR-0461 steps 2–5 were deployed on 2026-10-05: six WSL Nodes on `runtime-d78d6bf1-r1`, Mac knowledge residents and replica coordinator on `fleet-d78d6bf1`. Measurements use `/proc/stat` and per-unit `CPUUsageNSec` deltas; Windows values are 60 s averages of `Get-Counter`.

| Measurement | Before (`25d1abc9`, 60 s) | After, 60 s | After, 15 min average |
| --- | ---: | ---: | ---: |
| WSL VM busy, cores used | 4.76 | 1.36 | 0.70 |
| Lervo systemd units, % of one core | 306 | 63 | 51 |
| Busiest Node unit (lervo), % of one core | 139 | 15 | 29 |
| Windows `% Processor Utility` | 55 (Fable baseline) | not sampled | 11.6 |
| `vmmemWSL`, % of one logical processor | 547 (Fable baseline) | not sampled | 79.1 |

`% Processor Performance` averaged 122, so turbo still engages on remaining bursts under the Balanced plan. Disabling boost remains an owner decision. Fan speed and temperature were not readable over SSH and need owner confirmation. Argo workloads were observed only and not changed.
