# Change-driven work installed-artifact observation

Status: recorded
As of: 2026-09-11

## Scope and artifact

ADR-0399 was exercised on macOS arm64 with Node v26.5.1. A standalone distribution was built and verified by `pnpm node:distribution:build`, then installed into a fresh directory by `pnpm node:distribution:install`. No service was enabled.

- Archive SHA-256: `29de46407fb9d75d959e4d8a17dcba5db1c1b629ff4d45c5d2a82bc2f81f024a`.
- Installed executable SHA-256: `fdd9cd79fd3d20ec2fe90dc3b4b07fb77fa45e0c8b46c1144de5d81efdd36641`.

The installed `repository-replica reconcile --watch` command used two disposable Git repositories with identical initial commits. An instrumented local executable substituted for SSH, counted peer commands, and executed the installed peer runtime. This exercised the persistent process stream, real filesystem notifications, snapshot/bundle/apply commands, and coordinator. It does not establish network authentication or WSL behavior.

## Observations

The configured legacy interval was one second. After startup settled:

| Case | Observed result |
| --- | --- |
| Five-second unchanged interval | Zero remote snapshot commands |
| Modification inside an ignored cache directory | Zero additional remote snapshot commands |
| Twenty consecutive source writes | Four remote snapshot commands, including convergence checks |
| Final source content visible at peer | 1.327 seconds after the first write |
| Atomic readiness-request replacement | Woke reconciliation |
| Peer watch process count | One persistent process across all cases |
| SIGTERM shutdown | Coordinator exited zero; peer watcher no longer existed |

The short idle window intentionally excludes the 60-second recovery audit. It proves suppression of former one-second work discovery in this fixture, not zero long-term CPU cost or one snapshot per editor burst.

## Regression verification and limits

The full source suite passed 598 test files and 2,923 tests, with one opt-in benchmark skipped. Subsequent fixes preventing snapshot self-notification and recovery starvation passed eight affected test files and 28 tests.

Real Git cases preserve staged/unstaged and split-index state, exact transfer, stale-target rejection, divergent-history rejection, and explicit recovery refs. Fake-clock coverage verifies that a busy repository cannot postpone another repository's recovery check. Focused regression coverage addresses queue deadlines, current-policy filtering, health state publication, receipt wakeup, and loop cancellation.

Type checking, package boundaries, a full build, and built Node and installed CLI smoke checks also passed. The [change-driven work contract](../../specifications/coordination/node-change-driven-work.md) defines retained integrity, lease, retry, heartbeat, and recovery timers.

This record covers local implementation and installation tests. The subsequent authorized [WSL and coordinator rollout](node-change-driven-work-deployment.md) has separate operational evidence. Earlier ADR-0397 WSL CPU results do not measure ADR-0399. Arca burst attribution and fan/temperature causality remain outside this observation.
