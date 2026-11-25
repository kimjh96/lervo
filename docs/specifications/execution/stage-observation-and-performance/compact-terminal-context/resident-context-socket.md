# Resident context socket

[ADR-0562](../../../../decisions/foundation/0562-one-relation-web-one-context-assembler-and-a-stop-ledger.md) section 4 makes the terminal hook a thin client of the resident knowledge host. This page defines that channel and the order in which it lands. Until a slice below lands, the hook keeps preparing context in its own process, as [compact assembly](compact-assembly.md) and [runtime dispatch](runtime-dispatch.md) describe.

## Why

On 2026-11-25, with v0.47.8 on the Mac, a prompt hook spent:

- about 0.25 seconds starting Node, loading and verifying the bundle, and parsing the input;
- 0.7 to 2.2 seconds in its stages, mostly the repository snapshot walk (0.2 to 0.9 seconds) and the reads that open the project storage.

The resident host already runs on the same host as the same user. It holds the project storage open, watches the repository, and keeps the snapshot caches warm. ADR-0562 sets the target: a prompt hook p95 under 200 milliseconds end to end.

## Channel

- **Listener:** the resident knowledge host process (`lervo knowledge host`), one per user and host, listens once it holds the host resident lock. A process without the lock does not listen.
- **Address:** a local socket named `context.s` in this user's owner-only run directory, `<user state>/run/` (`userStateDirectory()`), with the same short-path fallback as process presence. On Windows it is the named pipe `\\.\pipe\lervo-context-<12 hex of the state directory hash>`. The directory is refused unless this user owns it and no one else can enter it, so only this user can connect.
- **Framing:** one request per connection. The request is one line of JSON; the response is one line of JSON; then both sides close. Either side drops a line over 256 KiB.
- **Request** (`terminal.context.request`, version 1):
  - `version`: 1.
  - `kind`: `prompt`. A later slice adds `stop`.
  - `build`: the hook runtime's build digest (`TERMINAL_HOOK_BUILD_DIGEST`).
  - `root`: the repository root the hook resolved.
  - `provider`: `claude` or `codex`.
  - `contract`: the hook contract id.
  - `input`: the provider's hook input exactly as read from standard input.
- **Response** (`terminal.context.response`, version 1):
  - `ok`, with `output`: the exact standard output the in-process hook would print, so the client prints it unchanged.
  - `declined`, with `reason`, and nothing printed.
- **Decline reasons** (closed for version 1):
  - `build_mismatch`: the host runs a different build than the hook. During an upgrade the two can differ, and the same output requires the same code.
  - `repository_not_hosted`: the host does not run a resident for that root.
  - `busy`: the host is already serving its bound of concurrent requests (4).
  - `invalid_request`: the request is malformed.

## Client behavior

- The hook connects first, with a connect timeout of 150 milliseconds and a response deadline of the hook budget minus the time already spent.
- On `ok` it prints `output` and exits.
- On `declined`, on no listener, or on a timeout or reset, it prepares context in its own process, exactly as before, and records the fallback cause as a stage outcome (`context_socket_<reason>`, or `context_socket_unreachable`). A fallback never changes what the provider receives; it only costs the in-process time.
- The hook never retries the socket within one invocation.

## Host behavior

- The host runs the same `runTerminalHookCommand` code the hook would, inside its own process, for a root it hosts. It reuses its open storage and warm caches.
- Each request has its own deadline, and the host answers `busy` beyond 4 concurrent requests, so one stuck request cannot stall the others or the resident cycles.
- It records every event and receipt before it answers, as the in-process hook does, so the delivery-order guarantees of ADR-0548 and ADR-0549 hold unchanged. Recording after answering is a later slice.

## Privacy

- Prompt text crosses the socket in memory only. The host never writes the request to disk and logs no request body. The events it records are the ones the in-process hook already records.
- Only processes of this user can connect, because of the owner-only directory or the per-user named pipe.

## Failure meaning

- A missing or unreachable listener means the hook works as before, slower. It is not an error and raises no attention.
- A `build_mismatch` that persists after an upgrade means the host still runs the previous build. The host's own runtime-change wake restarts it on the new build.
- Socket stage outcomes are recorded with the existing stage observations, so `lervo terminal budget` and the stage observations show how often prompts fell back and why.

## Slices

1. **Prompt over the socket.** The listener, the client with fallback, `build_mismatch`, `repository_not_hosted` and `busy`, and stage outcomes. Acceptance: on an idle host, a prompt answered by the host costs the hook its startup plus one socket round trip, and every fallback cause appears in the stage observations.
2. **Stop over the socket**, with the same fallback.
3. **Warm state in the host:** an in-memory repository snapshot that the repository watch keeps current and that a request re-validates before use, plus pooled storage. Acceptance: ADR-0562's prompt hook p95 under 200 milliseconds end to end on the Mac and WSL hosts.
4. **Record after answering.** The order guarantees are restated for events the host commits after the hook returns. When the host is unreachable, the hook prints the last cached base block and records `host_unreachable`, as ADR-0562 states.
