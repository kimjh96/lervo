# Separate installed WSL observation

Status: recorded
As of: 2026-09-11

## Installed verification

At 2026-09-11 01:19 UTC, the Hub and seven Node services passed actual-process bundle-hash and readiness verification with zero automatic restarts. Effective systemd overrides were included in the final executable check.

- Node bundle: `sha256:67b9d6806b1e8f67285457e2ce841015044c24ad472c3bf2c56b518dbecb866e`.
- Hub bundle: `sha256:111e0dce53ee084386fd1352b01f42a7acd2e67dd6f4869281d161d2a17cd25d`.

## Live process CPU

Equal 60-second windows observed the following CPU utilization, with one core equal to 100%. Each window retained one PID per service.

| Service | Before | After |
| --- | --- | --- |
| Lervo | 19.933% | 0.167% |
| Flemo | 9.233% | 0.517% |
| Shiflo | 11.383% | 0.817% |
| Plen | 1.783% | 0.250% |
| Arca | 2.017% | 0.117% |
| Digimon | 0.650% | 0.167% |
| AXLI | 1.283% | 0.217% |
| Hub | 1.000% | 0.183% |

These were live workloads, not a frozen-data replay or stack attribution.

## Hint behavior and claim boundary

Authenticated workstream and command hint requests each returned an initial changed response followed by a timeout after approximately 25 seconds, with 86-byte responses. This verifies the installed ADR-0397 path. It does not establish the later ADR-0399 follow-up, rare Arca bursts, or temperature/fan causality.
