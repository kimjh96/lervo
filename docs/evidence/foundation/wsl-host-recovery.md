# WSL host recovery and persistent Node startup

Status: recorded
As of: 2026-09-11 13:29 UTC

## Scope and observed failure

The user requested WSL recovery followed by all six outcome-supervision delivery stages and separately approved a Windows restart. Direct terminal operations were recorded as unmanaged operational observations, not managed provider execution.

Windows SSH initially succeeded. Ubuntu commands, root execution, the WSL system environment, and graceful shutdown timed out. WslService and the host compute service entered stop-pending states. The original WSL VM retained the Ubuntu VHD; restarting WslService exposed `ERROR_SHARING_VIOLATION` when opening it.

Exact process/VM identity checks preceded service and orphan-worker termination attempts, which did not clear the stalled VM. Windows then recorded bugcheck `0x0000003b` and an unclean restart, with boot time 13:18:48 UTC. No Windows reboot command was submitted. The crash occurred during recovery; its causal driver or kernel defect remains unestablished without dump analysis. The dump was neither copied nor inspected.

After the host returned, SSH and Ubuntu commands succeeded, and the root ext4 filesystem mounted read/write. This establishes restored access, not a permanent fix for the unknown Windows crash cause.

## Persistent service correction

Reboot exposed six obsolete persistent user-service launchers. Arca and Shiflo repeatedly failed because the old runtime could not read stored event schemas. The previously verified [ADR-0399 executable](node-change-driven-work-deployment.md) remained available with SHA-256 `fdd9cd79fd3d20ec2fe90dc3b4b07fb77fa45e0c8b46c1144de5d81efdd36641`.

All six configurations passed that executable's configuration preflight. Exact original service files and configuration hashes were retained in an owner-local recovery directory. Six persistent user-service drop-ins now select the verified executable and explicit Node binary. Configuration and credential files were preserved. AXLI already selected that runtime; the Hub retained its intended executable.

Arca was restarted as the canary. Shiflo recovered through its existing restart policy after daemon reload. The other four Nodes were restarted and observed individually. Rollback material, the exact service plan, and before/after observations remain under the host's fixed `.local/state/lervo/wsl-recovery-current` directory. The persistent drop-ins were not tested through a second Windows reboot.

## Recovery acceptance

All seven actual Node processes matched the verified executable hash. Their process-bound health snapshots reported readiness for sync, workstream replication, remote control, and conversation; workspace coordination remained disabled. A subsequent observation retained all seven PIDs with no additional restarts. Shiflo's restart counter retained 62 failures from before correction; it was neither reset nor reported as zero.

The Hub readiness endpoint returned HTTP 200 and the configured Hub identity. No Discord test message, repository commit, push, tag, public release, or new outcome-supervision activation occurred during this repair.

Outcome-supervision implementation continues separately through its [six delivery stages](../../roadmap/product-outcome-convergence/execution/outcome-supervision/delivery/sequence.md). This recovery establishes neither their installed acceptance nor AXLI event-history convergence.

## 2026-09-13 access restoration

Windows SSH remained available while a fresh Ubuntu process failed with `Wsl/Service/0x8007274c`. The existing WSL Hub answered its live endpoint, so the failure did not prove that all running Linux workloads had stopped. After the user explicitly authorized access recovery ahead of installed acceptance, `wsl.exe --shutdown` completed with exit code 0 within 45 seconds. No Windows reboot, force termination, or VHD replacement was requested.

Fresh Ubuntu commands then succeeded, and `/dev/sdd` mounted the root ext4 filesystem read/write. The Hub public `/v1/health/live` endpoint returned HTTP 200. A later observation found the same Hub PID 2681 and seven Node PIDs 2682, 2683, 2685, 2692, 2693, 2694, and 2695, all active with zero automatic restarts. This is a bounded access restoration and stable observation, not a diagnosis or permanent repair of the timeout cause.

The designated WSL repository received the three request-intake commits as patches after preserving its pre-existing untracked source file under `.lervo/state/request-path-preimage-20260913/`. Mac and WSL Git tree hashes then matched at `a4aae628b204d96dc96284a01b4186027f95b0ec`. WSL build, quality, task-base release-completion check, and eleven focused local/Discord contract tests passed; one live-process test remained skipped. A verified Node archive with SHA-256 `15b59a010b9bba81387ef127a613cd509c229d01d17218eabe067146063146f5` was installed at a new path and passed the current Lervo configuration preflight. The running service still used its previous executable and configuration without `outcomeSupervision`; no new Discord intake or production supervision activation was observed.
