# Change-driven work deployment observation

Status: recorded
As of: 2026-09-11 02:31 UTC

## Scope and artifacts

After ADR-0399 source and local installed-artifact acceptance, the user authorized deployment. Seven operating WSL Ubuntu Node services and the Mac repository replica coordinator were upgraded. A fresh Linux build matched the tested macOS executable SHA-256:

- Node and coordinator executable: `fdd9cd79fd3d20ec2fe90dc3b4b07fb77fa45e0c8b46c1144de5d81efdd36641`.
- Linux archive: `ade539e13bdfa74c875ed194aae11d62cab4d4e161e952e05b82eccb412d5a2a`.
- macOS archive: `29de46407fb9d75d959e4d8a17dcba5db1c1b629ff4d45c5d2a82bc2f81f024a`.

The verified installer used fresh targets. Exact predecessor service files, effective systemd overrides, and coordinator configuration were retained for rollback. Existing roots, credentials, identities, and conflict rules were preserved. No Git tag, public release, or npm publication was performed.

The Hub bundle remained `111e0dce53ee084386fd1352b01f42a7acd2e67dd6f4869281d161d2a17cd25d`; its ready endpoint returned HTTP 200 with the expected identity.

## Runtime and transport acceptance

Lervo was upgraded first; the other six Nodes followed after its acceptance. All seven actual process command lines referenced the new executable hash. Each passed three stable same-process ready observations after activation, including sync, workstream replication, remote control, and Discord conversation. Final observations reported zero automatic restarts.

The coordinator opened seven authenticated SSH peer streams whose process identities remained unchanged over 60 seconds. After startup settled, atomic replacement of the Shiflo readiness request produced a new equal-hash receipt in 6.128 seconds. This measures request-to-reconciliation completion, not transport latency alone.

Startup included transient SSH exit-255 failures, and the initial readiness-request probe did not finish within its 35-second observation. Later recovery refreshed all six non-divergent pairs. Launchd initially rejected immediate bootstrap after bootout; predecessor configuration was restored before the reviewed replacement was successfully activated with bounded bootstrap retry.

## Equal live CPU windows

Each before/after window lasted approximately 60 seconds and retained one PID per measured service. Values measure process CPU, with one core equal to 100%, excluding child-process CPU. The WSL Nodes already used ADR-0397 in the before window.

| Process | Before | After |
| --- | --- | --- |
| Lervo Node | 1.050% | 0.967% |
| Flemo Node | 0.433% | 0.483% |
| Shiflo Node | 0.750% | 0.983% |
| Plen Node | 0.200% | 0.200% |
| Arca Node | 0.250% | 0.250% |
| Digimon Node | 0.083% | 0.150% |
| AXLI Node | 0.117% | 0.167% |
| Unchanged Hub | 0.167% | 0.200% |
| Mac coordinator | 0.683% | 2.183% |

These live windows establish neither a frozen-workload comparison nor additional total CPU savings. Coordinator process CPU increased in its observed window; Git/SSH children and new peer watch processes were excluded. Persistent transport and verified runtime readiness are separate from performance attribution.

## Limitations

The Lervo source pair was already divergent before deployment; its last common receipt was dated 2026-09-10 22:13 UTC. The new coordinator continues to reject automatic overwrite. A stale successful receipt does not prove current parity. The other six configured pairs had fresh equal common/local/peer hashes after rollout. AXLI source-byte parity does not resolve its separately recorded event/workstream-history divergence.

Six pre-existing Mac-only sync services were outside this WSL rollout and reported `hub_unavailable` before deployment; their configurations were preserved. Arca burst profiling was explicitly excluded. No fan or temperature causality was measured.
