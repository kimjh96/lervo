# Lervo Hub event reader v2 activation

Status: `observed`  
Date: 2026-09-03

## Installation and service

The current deployed Hub 0.8.2 archive for Linux x64 glibc has SHA-256
`6ecaee40b7984f1a6aac38fe086bcbcde0ad414b504f63b1d384508cbe4383d8`.
Independent local and target-side digest checks matched, and its manifest contains 26
file entries. It was installed at
`/home/jonghyeok/.local/lib/lervo-hub/0.8.2-6ecaee40`; previous installations were
retained for rollback.

The canonical systemd definition now binds the standalone entry point directly to
`/home/jonghyeok/.local/lib/node-v26.5.1-linux-x64/bin/node`; it does not resolve the
bundle shebang through ambient `PATH` or call an external launcher. The service
definition SHA-256 is
`c69faf08cb1314278d378affe4b25436975063c31e50fdb4b5425451f53af31a`. The prior
definition and launcher were retained as rollback material but are not on the active
execution path.

## Reader evidence and activation

Requests through both loopback and the authenticated public route to
`/v1/health/capabilities` returned `readableEventSchemaVersions: [1, 2]`. The collected
reader evidence covered the Hub, local runtime, and Node, and showed that all three
could read event schema versions 1 and 2.

Event writer activation plan `evplan_fa4b862901e5318ce1026fe6` produced activation
`evact_8fe3967cc595ff4a0e882d69`, which selected writer version 2. The coordinate has
SHA-256 `6418c5a0a1b95a107dcd6279997c81d3f4b256d2a6408f3d02e20e53a95ec0c7`.

The activation followed the reader-first process, applies only to future events, and
preserves version 1 history. By itself, it does not prove Node delivery, provider use,
task correctness, graceful shutdown, or future availability.

## Operational verification and follow-up

- The prior Hub reproduced the shutdown defect with established loopback connections:
  it stopped listening but remained in systemd `stop-sigterm` until explicitly
  terminated.
- The replacement runtime had four established loopback connections immediately before
  the same stop test. It stopped in 0.02 seconds with systemd `Result=success` and exit
  status 0. After restart, three consecutive readiness requests returned `ready`, the
  Hub advertised event-reader versions 1 and 2, and all six registered repository Nodes
  returned to `ready`.
- The service renderer and transactional manager upgraded the definition to bind the
  exact Node executable and non-executable JavaScript entry point. Systemd reported
  the service active with `Result=success`, `ExecMainStatus=0`, and no restart; the
  observed MainPID command matched those canonical arguments.
- Three consecutive readiness requests returned `ready` after the service-composition
  upgrade. Repository fleet status was briefly degraded while Nodes reconnected, then
  all six registered Nodes returned to `ready`.

The HTTP shutdown gap is resolved by explicit idle-connection close plus a tested
10-second upper drain bound for incomplete active requests. The standalone launcher
composition gap is resolved by the optional, exact `--node-executable` service input.

## References

- [WSL Hub and Shiflo release acceptance](wsl-hub-shiflo-release-acceptance.md)
- [Hub and Node coordination specification](../../specifications/coordination/hub-and-node.md)
- [Lervo Hub standalone distribution](../../distribution/hub-runtime-distribution.md)
- [ADR-0164: User Runtime Service Management with Explicit Writes](../../decisions/operations/services/0164-user-runtime-service-management-boundary.md)
- [ADR-0335: Record and verify bounded execution stage evidence](../../decisions/operations/trace/0335-record-and-verify-bounded-execution-stage-evidence.md)
