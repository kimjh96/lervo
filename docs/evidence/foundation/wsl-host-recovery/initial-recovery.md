# Initial WSL recovery and persistent startup

## Scope and observed failure

The user requested WSL recovery followed by all six outcome-supervision delivery stages and separately approved a Windows restart. Direct terminal operations were recorded as unmanaged operational observations, not managed provider execution.

Windows SSH initially succeeded, but Ubuntu commands, root execution, the WSL system environment, and graceful shutdown timed out. WslService and the host compute service entered stop-pending states. The original WSL VM retained the Ubuntu VHD; restarting WslService exposed `ERROR_SHARING_VIOLATION` when opening it.

Exact process/VM identity checks preceded service and orphan-worker termination attempts, which did not clear the stalled VM. Windows then recorded bugcheck `0x0000003b` and an unclean restart, with boot time 13:18:48 UTC. No Windows reboot command was submitted. The crash occurred during recovery; its causal driver or kernel defect remains unestablished without dump analysis. The dump was neither copied nor inspected.

After the host returned, SSH and Ubuntu commands succeeded, and the root ext4 filesystem mounted read/write. This establishes restored access, not a permanent fix for the unknown Windows crash cause.

## Persistent service correction

Reboot exposed six obsolete persistent user-service launchers. Arca and Shiflo repeatedly failed because the old runtime could not read stored event schemas. The previously verified ADR-0399 executable remained available with SHA-256 `fdd9cd79fd3d20ec2fe90dc3b4b07fb77fa45e0c8b46c1144de5d81efdd36641`.

All six configurations passed that executable's configuration preflight. Exact original service files and configuration hashes were retained in an owner-local recovery directory. Six persistent user-service drop-ins now select the verified executable and explicit Node binary. Configuration and credential files were preserved. AXLI already selected that runtime; the Hub retained its intended executable.

Arca was restarted as the canary. Shiflo recovered through its existing restart policy after daemon reload. The other four Nodes were restarted and observed individually. Rollback material, the exact service plan, and before/after observations remain under the host's fixed `.local/state/lervo/wsl-recovery-current` directory. The persistent drop-ins were not tested through a second Windows reboot.

## Recovery acceptance

All seven actual Node processes matched the verified executable hash. Their process-bound health snapshots reported readiness for sync, workstream replication, remote control, and conversation; workspace coordination remained disabled. A subsequent observation retained all seven PIDs with no additional restarts. Shiflo's restart counter retained 62 failures from before correction; it was neither reset nor reported as zero.

The Hub readiness endpoint returned HTTP 200 and the configured Hub identity. No Discord test message, repository commit, push, tag, public release, or new outcome-supervision activation occurred during this repair.
