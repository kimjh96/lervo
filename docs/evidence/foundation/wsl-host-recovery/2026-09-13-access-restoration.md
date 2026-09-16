# 2026-09-13 access restoration

## Bounded recovery

Windows SSH remained available while a fresh Ubuntu process failed with `Wsl/Service/0x8007274c`. The existing WSL Hub answered its live endpoint, so the failure did not prove that all running Linux workloads had stopped. After the user explicitly authorized access recovery ahead of installed acceptance, `wsl.exe --shutdown` completed with exit code 0 within 45 seconds. No Windows reboot, force termination, or VHD replacement was requested.

Fresh Ubuntu commands then succeeded, and `/dev/sdd` mounted the root ext4 filesystem read/write. The Hub public `/v1/health/live` endpoint returned HTTP 200. A later observation found the same Hub PID 2681 and seven Node PIDs 2682, 2683, 2685, 2692, 2693, 2694, and 2695, all active with zero automatic restarts. This is a bounded access restoration and stable observation, not a diagnosis or permanent repair of the timeout cause.

## Intermittent launch failure

One later fresh Ubuntu launch again returned `Wsl/Service/0x8007274c` while repository knowledge refresh and mandate inspection were running. The existing Hub still answered HTTP 200. After those operations ended, ten sequential new Ubuntu launches all succeeded in 0.328–0.396 seconds without another shutdown.

No matching warning or error was found in the queried Hyper-V Compute, Host Network Service, System, or Application event logs for the preceding 45 minutes. The intermittent launch failure remains unrooted; the successful sequence is not evidence of a permanent correction.

## Repository and runtime validation

The designated WSL repository received the three request-intake commits as patches after preserving its pre-existing untracked source file under `.lervo/state/request-path-preimage-20260913/`. Mac and WSL Git tree hashes then matched at `a4aae628b204d96dc96284a01b4186027f95b0ec`.

WSL build, quality, task-base release-completion check, and eleven focused local/Discord contract tests passed; one live-process test remained skipped. A verified Node archive with SHA-256 `15b59a010b9bba81387ef127a613cd509c229d01d17218eabe067146063146f5` was installed at a new path and passed the current Lervo configuration preflight.

The running service still used its previous executable and configuration without `outcomeSupervision`; no new Discord intake or production supervision activation was observed.
