# ADR-0579: Describe the bundled Node runtime once per upgrade and time its stages

Status: `accepted`
Decision date: 2026-11-17
Amends: [ADR-0575](0575-follow-published-releases-on-every-host.md) (the pass entry records stage timings)
Related: [ADR-0483](../coordination/sync/0483-run-replica-commands-through-one-current-runtime.md) (the replica stage reads the bundled runtime), [ADR-0574](0574-admit-upgrades-ahead-of-background-knowledge-cycles.md) and [ADR-0577](0577-keep-the-upgrade-exclusion-through-event-loop-stalls.md) (the host-wide exclusion an apply holds)

## Context

On 2026-11-17 the WSL host follower upgraded six repositories to v0.25.1 in 28.7 minutes. Five of the six applies changed only `repository_node`, yet each took 73 to 166 seconds while it held the host-wide full-cycle admission.

The timeline below comes from three read-only sources: the follower's `lastPass` entries, the systemd journal of each `lervo-node-*` unit, and the `updatedAt` that `registerNodeFleetInstance` wrote to `node-fleet.json` after readiness. Times are seconds and accurate to about one second, because the pass measures the end of each command after its process exits.

| Repository | Plan command | Admission wait | Apply to stop | Stop to start | Start to registration | Registration to end | Apply total |
| ---------- | -----------: | -------------: | ------------: | ------------: | --------------------: | ------------------: | ----------: |
| axli       |           26 |            300 |            52 |           2.3 |                    76 |                  36 |         166 |
| plen       |           17 |              2 |            44 |           1.7 |                   3.1 |                  24 |          73 |
| flemo      |           24 |              0 |            56 |           1.7 |                   4.1 |                  35 |          97 |
| digimon    |           23 |             46 |            55 |           1.8 |                   3.1 |                  38 |          98 |
| shiflo     |           28 |              0 |            70 |           1.9 |                    15 |                  43 |         130 |
| lervo      |          123 |             46 |           265 |           2.1 |                    33 |                 184 |         484 |

The service transition is not the cost. systemd stopped every worker within one second of SIGTERM, and the new process started about one second later. Start to registration covers the start stabilization (three observations 500 ms apart), the readiness poll (three ready observations 500 ms apart), and the registry write. It took 3 to 4 seconds on three repositories. axli took 76 seconds, the first repository of the pass, which started right after its 300-second admission wait. Nothing recorded tells which component it waited for.

The rest is repeated observation. A timing script on the WSL test mirror called each plan inspection twice against a copy of plen and the live read-only Node inspection. It measured `inspectKnowledge` at 8.0 to 8.7 seconds, `lintKnowledge` at 4.1 to 4.6, `describeInstalledNodeLauncher` at 1.2 to 2.7 warm and 7.1 cold, the runtime retention inventory at 1.5 to 2.1 warm and 8.5 cold, and the replica inspection at 2.3 to 2.5. Every other inspection took under 0.2 seconds.

`describeInstalledNodeLauncher` reads the CLI's bundled Node payload and hashes every file of its dependency closure: 101 packages and 5,544 files on WSL. One repository's upgrade described it nine times. The plan command did it twice, in the Node inspection and in the replica inspection. The apply did it seven times: twice in the plan it recreates inside the exclusion, once when the Node stage inspects again, once to install the launcher, once when the deferred replica stage inspects again, and twice in the final plan. The replica inspection costs what it does because it describes the runtime too.

## Decision

### One command describes the bundled runtime once

`describeInstalledNodeLauncherOnce()` returns a description function that reads and hashes the bundled payload, the repository runtime module, and the dependency closure on its first call. Later calls reuse that result and place the launcher and payload paths under the home directory they name. A failed read is not kept, so the next call reads again.

`upgradeHost()` creates one such function per `lervo upgrade` command as `describeNodeLauncher`. The plan's Node inspection, the replica service ports, the apply's Node inspection, and the launcher installation in `applyNodeFleetOnboarding` all use it. `upgradeHost()` without options now builds the live replica ports itself so that they share the function; they are the same ports the replica stage built by default before.

Every stage of one command must bind the same runtime bytes. The first description is the bytes the running CLI loaded, so reading them again could only report a different install in the middle of the command. Installing the launcher still writes those bytes and verifies every dependency file against the described hashes, so changed files on disk still fail the install. Callers outside an upgrade keep `describeInstalledNodeLauncher`, which reads every time.

### The apply receipt and the pass record stage timings

`lervo upgrade --apply --json` receipts gain `stageTimings`: the parts of the apply after admission, in the order they ran, as `{ stage, ms }`. `ms` is wall time rounded to whole milliseconds, measured on the monotonic clock. The parts do not overlap, so their sum is close to `timing.applyMs`. Each part covers its stage's inspection, exclusion confirmation, and apply:

- `plan`: the plan recreated inside the exclusion and its approval check.
- `capabilities`, `workforce`, `terminal_integration`, then `knowledge` once per generated-only round.
- `node_inspection`, then the Node stage. When it replaced the deployment, the stage is split into `node_preparation`, `node_service` (fences, stop, definition replacement, and start), `node_readiness`, and `node_completion` (fleet registration, the runtime pointer, and runtime maintenance). Otherwise it is one `node` part.
- `knowledge_lint`, `event_writer`, `host_service`, `replica_service`, `runtime_retention`, and `final_plan`.

The Node onboarding receipt gains `timing` with `preparationMs`, `serviceMs`, `readinessMs`, and `completionMs`. Each follower pass entry in `lastPass` gains `stageTimings`: for each round, the plan command's wall time as `plan_command`, then the receipt's parts, each with its `round`. The follower ignores a receipt list with more than 64 entries and drops entries without a string `stage` and a finite, non-negative `ms`.

All three fields are additive. Receipts and passes of earlier CLIs lack them, and the follower reads those as before. They hold stage names and durations only: no path, process ID, or repository content. A missing or partial list means that the apply did not report it. It is not evidence that a stage was skipped. A failed apply prints no receipt and therefore no timings.

### Repositories still upgrade one at a time

The pass does not restart several repositories' workers at once. Each apply holds the host-wide full-cycle admission from the plan inside the window through its final plan, and ADR-0577 confirms that exclusion before every stage that changes a service. Two applies would need two holders of one host-wide slot, or a Node stage outside the window. The first breaks ADR-0574, and the second lets a resident knowledge cycle run while its repository's Node restarts. The service transition is also 2 of the 73 to 166 seconds, so overlapping it would gain little. The measured cost is repeated observation inside each apply, and this decision removes part of it.

## Consequences

- Each upgrade describes the bundled runtime twice instead of nine times: once in the plan command and once in the apply. At the measured 1.2 to 2.7 seconds per warm description, an apply saves about 8 to 19 seconds and a WSL pass of six repositories about 50 to 115 seconds. A cold first read costs up to 7 seconds and is no longer repeated. This is an estimate from the measured parts; the next rollout's `stageTimings` will show the real effect.
- The largest remaining repeated cost is knowledge inspection. One upgrade runs `inspectKnowledge` four times (the plan command, the plan inside the window, the knowledge stage loop, and the final plan) and `lintKnowledge` once, about 36 seconds on a plen-sized repository. Moving knowledge materialization out of the upgrade is a separate change and may remove this.
- The runtime retention inventory walks every retained runtime tree: 6 directories of about 6,500 files each on WSL. It runs in every plan and again in the Node stage's runtime maintenance, about 1.5 to 3.3 seconds each time. Follow-up: walk only the trees that can become retirement candidates, and prove with `node-runtime-retention.test.ts` that the candidates do not change.
- Retention never retires anything on WSL today. Two units there, `lervo-hub.service` and `lervo-host-follow.service`, pass `--config` in a form the Node service coordinate parser does not read, so `collectRuntimeServiceReferences` throws and the plan reports `runtime_references_unavailable`. Six runtimes of about 350 MB each remain. Follow-up: resolve `--config` for non-Node Lervo units in `node-runtime-service-references.ts`, with a test of a hub and a follower definition beside a Node definition.

## Verification

- `node-fleet-runtime-description.test.ts`: one description function serves two concurrent calls and a call for another home with a single dependency read and the same hash. A failed read is retried, and the uncached function reads every time. On origin/main, `describeInstalledNodeLauncherOnce` does not exist.
- `upgrade-host.test.ts`: for an isolated home and for the live host, the replica ports and the Node stage use the host's one description function. On origin/main, the live host has no replica ports and the isolated home reads the runtime directly.
- `upgrade-node-dependencies.test.ts`: the Node inspection and the onboarding receive the given description function. On origin/main, the inspection ignores it.
- `upgrade-stage-timing.test.ts`: laps sum to the measured wall time, and the Node stage splits into its four parts with the unmeasured remainder counted as preparation.
- `upgrade-safe-apply.test.ts`: a real `--apply --safe` receipt starts with `plan`, ends with `final_plan`, includes the knowledge, Node inspection, lint, and retention parts, and sums to at most `timing.applyMs`. `repository-command.test.ts`: an onboarding receipt carries the four timing parts. `host-repository-pass.test.ts`: a two-round pass records `plan_command` and the receipt's parts per round, and the runner drops invalid entries. On origin/main, these assertions fail because the fields do not exist.

Installed verification: after the release that carries this change, read `stageTimings` from the next follower pass on WSL and on the Mac, and record the per-stage breakdown in the [release-to-fleet roadmap](../../roadmap/operations/release-to-fleet.md).
