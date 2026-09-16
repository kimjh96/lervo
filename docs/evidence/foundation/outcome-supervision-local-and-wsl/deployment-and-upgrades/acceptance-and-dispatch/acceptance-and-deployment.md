# Acceptance and deployment history

## Acceptance boundaries

The approved thirteen-scenario requests and responses were sent and observed. Scenarios 8–12 and corrected scenarios 1–4 used grouped native owner turns; these are not thirteen separate installed intake journeys. Actual #lervo delivery and replay passed. See the [per-scenario limits](../approved-discord-acceptance.md).

Final writing acceptance, canonical completion of the historical goal, and production supervision activation remained unresolved at the initial checkpoint. All seven WSL Node configurations then omitted `outcomeSupervision`. The unknown run and expired mandate must not be converted to zero usage or renewed as a substitute for missing settlement evidence. Installed fixture results do not close the original six-stage acceptance gate.

Later checkpoints below record Node activation and registration; [settlement and the budget incident](settlement-and-budget.md) records subsequent run settlement and service shutdown. Installed `/goal` invocation, accepted result, and Discord delivery remain open.

## Native `/goal` implementation checks

On 2026-09-14, the native guild `/goal` request path was added behind the installed supervised-owner configuration. Focused parser, REST acknowledgement, conversation-adapter, canonical intake, and Discord runtime checks passed, along with type checking, repository quality, document lifecycle, and base-bound release-intent checks.

Before follow-up, the full suite reported 692 passed files, three failed files, and seven skipped files: 3,508 passed tests, four failed tests, and eight skips. Follow-up corrected two failures:

- A retained pre-effect authority fixture expected `uncertain` where the documented preflight contract returns `blocked`; its expectation was corrected.
- A macOS replica receipt watcher missed an atomic notification and waited four seconds; bounded one-second receipt rechecks restored the 421–468 ms focused wakeup.

Both corrected files now pass eight focused tests. Two first-publication metadata checks still detect differences between locally built CLI archives and the existing release manifest while release intent is pending. This is not production `/goal` acceptance. No slash invocation, renewed mandate, or Node rollout was observed at that checkpoint.

## Assignment and mandate 10

On 2026-09-13, after WSL access was restored, the designated repository still reported assignment `asn_a4daa2f0a97abcde8083dbb9` as `leased` at generation 17, with an expired lease timestamp of 2026-09-12 23:13:26.114 UTC. This does not establish an active provider process or authorize repeating its unknown run. A new version-3 goal scope cannot exclude a leased predecessor under the reviewed work-scope contract. Local/Discord contract tests and a preflighted archive remain separate from installed acceptance.

Canonical mandate inspection first identified `supervision.research.acceptance` version 9 as expired at 2026-09-12 23:38:03.133 UTC. Its path scope is `docs/product/vision.md`, maximum aggregate budget is 1,500,000 tokens, and action list omits `publish_result`.

Successor version 10 was installed on the designated WSL host:

- Event: `evt_8aea6c54ecb0cf32c070ed50cef19c27`.
- Mandate hash: `sha256:0d4e9d8224c94d278edc5aa2fa2c4ed669866ddc9c587829f4843c1022c297e5`.
- Installation review hash: `sha256:33737650b78c25e7e4be4c24aa136fc8524fe3580179daa5dd46d26fc9fe8079`.
- Expiry: 2026-09-13 16:18:03.363 UTC.

Canonical inspection confirmed unchanged work scope, staff and path limits, the same 1,500,000-token aggregate ceiling, and added `publish_result` authority. Installation did not settle the uncertain correction run.

Node bundle `sha256:6d3d55a7948b5a41c277e1279042ba700ea168a8c519170fd25d6feef7e48a08` remained staged outside the running service. A mode-0600 candidate service configuration bound to mandate 10 passed Node configuration preflight; a separate local supervision configuration passed syntax validation. A 25-second local supervision process using the staged bundle emitted `supervision_attention_required` twice and exited on the test timeout.

A fresh bounded read still showed exactly the correction run's five original events; the latest canonical event was mandate installation. These observations showed no new provider effect, successful owner acceptance, healthy supervised service, native Discord registration, or slash invocation. The existing Node service remained on its prior configuration without `outcomeSupervision`.

## Managed-worker confirmation correction

A subsequent correction requires one ordered adapter-stop and terminal pair before child process exit can confirm its effect. A zero-exit child with only request records now remains uncertain.

Three focused subprocess cases and the existing seventeen managed-process and supersession cases passed on each Mac and WSL. Type checking, quality checks, Node and CLI builds, document lifecycle checks, and task-base release-intent checks passed. Both source trees matched at `02fa382d3d650081e77582d90057131e61a26bb3`.

Corrected WSL Node bundle `sha256:c8a2f32746705ce24186584cbca16ad44309001b4f2af59aaec7081bd4647a45` was staged inactive and passed candidate configuration preflight. This prevents future false confirmation; it neither resolved the old correction run nor activated `/goal`.

## WSL operational checkpoint

The designated Ubuntu instance restarted twice at 2026-09-14 00:27:39 and 00:28:48 KST while Windows remained booted since 2026-09-13 09:03:18 KST. The preceding WSL journal recorded repeated delayed vsock accepts and a coordinated systemd shutdown, without identifying its requester.

Kernel records showed repeated memory-cgroup OOM kills inside Arca-next containers. This establishes container instability, not causation of the WSL restarts or the user's CPU/fan load. After restart, Hub and seven Nodes were running with no failed user units; a later fresh Ubuntu command took approximately nineteen seconds to start. WSL timeout root cause and operational stability remained unverified. See [subsequent startup investigation](wsl-startup.md).

## Mandate 11 and Node activation

Mandate 11 succeeded version 10 after the workstream checkpoint changed. Its exact candidate diff changed only `version`, `issuedAt`, and `expiresAt`; scope, staff, capability, action, path, host, and 1,500,000-token budget coordinates remained unchanged.

- Installed event: `evt_e770d732488ed4d0355775019d4f1a8e`.
- Mandate hash: `sha256:70f789a2bd618efd001aa3ac931bef8de169968df0bce81af1cc7e7705c2d196`.
- Review hash: `sha256:9a39cd417d8e7ac153df2d41174f2d5845786895db6b544870875d64cf5ef467`.
- Expiry: 2026-09-13 17:51:58.697 UTC.

Mode-0600 Node and local candidate configurations bound to version 11 passed syntax preflight; neither was active at this checkpoint. The unknown run and installed acceptance boundary were unchanged.

At 2026-09-14 01:10:08 KST, designated Lervo Node unit `lervo-node-28de5803e2db5aec8bd4ee7d.service` switched under a removable final systemd drop-in to separately installed bundle `sha256:8a734cbdbf74e0e7213516d90fbc12f17a87a85e222afc7068c05fca4b36622d` and the version-11 candidate Node configuration. Preflight passed. The service remained active at PID 84158 with zero automatic restarts; the old executable and configuration remained available for rollback.

An authenticated Node HTTP GET to Discord returned 200 and exactly one guild `/goal` command for application `1547393266193006632` in guild `1546479354773508176`: command ID `1548727578108633189`, with the reviewed current-goal description and request option. A Python urllib probe received Cloudflare 1010; repeating the read through Node's HTTP client succeeded. The Python probe therefore does not establish a Discord bot permission denial. The other configured application had zero `/goal` commands, as expected.

No real slash invocation, bound request, accepted result, or delivery had been observed. The correction run still had its five original events; Node registration did not settle it.

## Mandate 12

After the designated workstream advanced to revision 540, mandate 12 succeeded version 11. The reviewed candidate changed only `version`, `issuedAt`, and `expiresAt`; predecessor event and hash matched version 11. Path, staff, action, host, and the 1,500,000-token ceiling were unchanged.

- Installed event: `evt_100d9418075b771f72de922a75853348`.
- Mandate hash: `sha256:5d6e419bc25f79d5c55e60371565c1a112e07d520907872b02be22db152c1fc7`.
- Review hash: `sha256:2049459516850ac9a6f8d1b862823d2b3db70dcbaf4d155a412f8387078e9e05`.
- Expiry: 2026-09-13 18:17:26.959 UTC.

Separate mode-0600 Node and local configurations changed only the binding mandate hash from version 11; both passed syntax preflight. The Lervo service switched to the version-12 Node configuration at 01:19:44 KST and remained active at PID 105224 with zero automatic restarts.

A fresh read-only authority observation returned eligible, unrevoked, and source digest `sha256:95420511ebe9dec62b1115f44ed90e97af8c8c427eb344f4a6416c7cb090baae`. An authenticated Discord GET still found exactly the one reviewed `/goal` command. Version-11 and predecessor runtime definitions remained available for rollback. Renewal grants no exception for the incomplete correction run or missing end-to-end acceptance.
