# WSL startup failure observations

## Failure evidence and limits

The designated host runs WSL 2.7.12.0 with Ubuntu systemd enabled. Instance boots ending at 2026-09-13 15:27:36 and 15:28:45 UTC performed orderly systemd service shutdown while Windows remained booted. The intervening boot recorded:

- 15:27:49 UTC: `WaitForBootProcess: /sbin/init failed to start within 10000ms`.
- 15:28:45 UTC: `InitTerminateInstanceInternal: systemctl poweroff did not terminate the instance in 10000 ms`.

Windows Hyper-V Compute and Worker logs corroborate new VM starts at 15:27:38 and 15:28:46 UTC. No retained event identifies the shutdown requester.

Running scheduled task `arca-next-wsl-bootstrap` holds `wsl.exe -d Ubuntu --exec /usr/bin/sleep infinity`; it does not itself show a shutdown action. Earlier kernel records show repeated Arca-next container-memory-cgroup OOM kills, latest at 15:21:56 UTC. Neither full-VM OOM nor a causal link to shutdown is proven. An [upstream WSL issue](https://github.com/microsoft/WSL/issues/14541) reports a similar early systemd/vsock exec timeout; similarity does not identify this host's initiating fault.

## Reversible boot-path repair

The concrete boot bottleneck was enabled unit `/etc/systemd/system/arca-next@.service`: its `docker compose up -d --no-build` is a `Type=oneshot` unit wanted before `multi-user.target`. On the prior boot it occupied 2 minutes 25.460 seconds and exited 1 because `arca-next-lifetime-economic-ledger` was unhealthy. `graphical.target` was reached only after 2 minutes 29.622 seconds.

A reversible host-only change disabled the service's direct `multi-user.target` activation and enabled `/etc/systemd/system/arca-next@.timer` with `OnBootSec=15s`. The Compose service file and current containers were unchanged. The timer was deliberately left inactive until a controlled reboot. The supervised Lervo Node was disabled before reboot because its installed version-13 mandate was over budget.

## Controlled restart verification

At 2026-09-13 17:23:49 UTC, controlled `wsl --shutdown` completed in 11.4 seconds. The first new `wsl.exe -d Ubuntu --exec /bin/true` succeeded in 4,334 ms on boot `b7b5e8d8-913f-41ad-82f4-d8db10b5aa30`; `graphical.target` was reached in 4.050 seconds.

The timer triggered at 17:24:18 UTC, after the target was ready. The unchanged Arca Compose service completed successfully four seconds later, and `arca-next-lifetime-economic-ledger` reported healthy. Five additional Windows-to-Ubuntu commands during this startup all succeeded in 58–97 ms.

The timer is enabled, direct service activation is disabled, and the budget-fenced Lervo Node remains disabled and inactive. This verifies the boot-path repair under one cold restart; the prior shutdown initiator and long-run recurrence remain unproven.
