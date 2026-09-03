# Lervo Hub event reader v2 activation

Status: `observed`  
Date: 2026-09-03

## Installation and service

The current Hub 0.8.2 archive for Linux x64 glibc has SHA-256
`5364cd29bf3851bd60c365b22444d2bc14217fb4c7bce10027dcd9bbe1e8cb82`. Target-side
verification confirmed its 26 file entries before it was installed at
`/home/jonghyeok/.local/lib/lervo-hub/0.8.2-5364cd29`. The previous installation was
retained for rollback.

Systemd uses a separate, content-addressed launcher because its environment could not
resolve the Node executable named in the bundle's shebang. The launcher invokes
`/home/jonghyeok/.local/lib/node-v26.5.1-linux-x64/bin/node`. Its SHA-256 is
`8dff9a27a0ee0e8d5f5db5531a6f4a5e6ec46d390c2d6e9654f65d40a42e9751`, and the
service definition SHA-256 is
`92b9de7909d8bbc9ef8922e0c0256d3776110e32f0e9c349ff771907b1efebff`. Three
consecutive observations found the service active.

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

## Operational follow-up

- Hub shutdown exceeded the 30-second transactional wait. Systemd then reached its
  120-second timeout and sent `SIGKILL`.
- A standalone Hub service currently needs an external launcher with an absolute Node
  path when the systemd `PATH` lacks `node`.

Both gaps remain open until a separately verified implementation removes them.

## References

- [WSL Hub and Shiflo release acceptance](wsl-hub-shiflo-release-acceptance.md)
- [Hub and Node coordination specification](../../specifications/coordination/hub-and-node.md)
- [Lervo Hub standalone distribution](../../distribution/hub-runtime-distribution.md)
- [ADR-0164: User Runtime Service Management with Explicit Writes](../../decisions/operations/services/0164-user-runtime-service-management-boundary.md)
- [ADR-0335: Record and verify bounded execution stage evidence](../../decisions/operations/trace/0335-record-and-verify-bounded-execution-stage-evidence.md)
