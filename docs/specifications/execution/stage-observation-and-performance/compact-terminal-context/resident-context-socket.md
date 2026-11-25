# Resident context socket

[ADR-0562](../../../../decisions/foundation/0562-one-relation-web-one-context-assembler-and-a-stop-ledger.md) section 4 makes the terminal hook a thin client of the resident knowledge host. This page defines that channel and the order in which it lands. Until a slice below lands, the hook keeps preparing context in its own process, as [compact assembly](compact-assembly.md) and [runtime dispatch](runtime-dispatch.md) describe.

## Why

On 2026-11-25, with v0.47.8 on the Mac, a prompt hook spent:

- about 0.25 seconds starting Node, loading and verifying the bundle, and parsing the input;
- 0.7 to 2.2 seconds in its stages, mostly the repository snapshot walk (0.2 to 0.9 seconds) and the reads that open the project storage.

ADR-0562 sets the target: a prompt hook p95 under 200 milliseconds end to end. A long-lived process alone does not reach it: in a warm process the snapshot walk still costs 0.7 to 0.9 seconds, because each capture re-reads its stat cache and stats every file. The gain comes from state the host keeps between prompts. Slice 0 measures that before the channel is built.

## Deviations from ADR-0562 until slice 4

- When the host is unreachable or declines, the hook prepares context in its own process, opening the store and running Git, instead of printing a cached base block and recording `host_unreachable`.
- The hook sends its raw provider input instead of only the prompt and transcript position, so the host runs exactly the code the hook would.

## Channel

- **Server:** a context server process that the resident knowledge host (`lervo knowledge host`) spawns and supervises while it holds the host resident lock. The server runs the installed hook runtime, the same file the hook launcher verifies and loads, in a serve mode, so the server and the hook run identical code by construction. Being its own process, it:
  - has its own process id, so checks that treat the current process id as proof that a lock or journal belongs to someone else stay correct;
  - cannot be held by a resident cycle that blocks the host's event loop;
  - can be stopped and restarted to drop work a deadline abandoned.
- **Supervision:** the host restarts the server when it exits and when the installed runtime pointer names a different runtime, so a server never outlives an upgrade.
- **Address, Unix:** the socket `context.s`, mode 0600, in this user's owner-only directory `<user state>/run/context/`. The directory uses the same short-path fallback as process presence, under its own `context` subdirectory. Only the server started by the lock holder unlinks a leftover socket and then listens; a hook never removes it.
- **Windows:** no listener before an authenticated channel exists. A named pipe name shares one machine-wide namespace, so another local user could create it first and receive prompt text. Windows hooks always prepare context in process until a slice adds a server proof (a key in an owner-only file).
- **WSL:** a state directory on a Windows drive (DrvFs) cannot hold a socket. The host reports that as `context_socket_unavailable` attention instead of falling back silently.
- **Framing:** one request per connection, with a commit handshake so a prompt is recorded once:
  1. The client writes one line of JSON.
  2. The server writes `A` as soon as it has read the line.
  3. Before its first durable write (an event, receipt, or state file), the server writes `C` and waits for `G`.
  4. The client writes `G` only while it can still wait for the answer. After `G` it never falls back.
  5. The server writes one line of JSON, and both sides close.
  - A server that does not receive `G` within its deadline abandons the request before writing anything, so the client's fallback is the only record.
  - Either side drops a line over 256 KiB.

## Request and response

- **Request** (`terminal.context.request`, version 1):
  - `version`: 1.
  - `kind`: `prompt`. The client parses the input first and sends only `UserPromptSubmit`; `SessionStart`, `Stop`, and the workspace recording hooks stay in process.
  - `runtime`: the content hash of the verified hook runtime the launcher loaded (its manifest `contentHash`). The server declines a request whose hash differs from its own.
  - `root`: the realpath of the repository root the hook resolved. For a linked worktree this is the worktree, not its main checkout.
  - `provider` and `contract`.
  - `environment`: the values of every variable the hook path reads: `LERVO_TERMINAL_HOOK_RUNTIME`, `CODEX_HOME`, `LERVO_USER_STATE_DIRECTORY`, and `XDG_STATE_HOME`. The list is closed and checked by a contract test that fails when the hook path reads a variable not on it.
  - `deadline`: the remaining hook budget in milliseconds, and `elapsed`: the client's time spent so far.
  - `input`: the provider's hook input exactly as read from standard input.
- **Response** (`terminal.context.response`, version 1):
  - `ok`, with `stdout`, `stderr`, and `exitCode`: what the in-process hook would have produced. The client writes both streams and exits with that code.
  - `declined`, with `reason`, always sent before `C`, so nothing was recorded.
- **Decline reasons** (closed for version 1):
  - `runtime_mismatch`: the server's runtime hash differs from the request's, as during an upgrade.
  - `environment_mismatch`: a value in `environment` differs from the host's.
  - `repository_not_hosted`: the host runs no resident for the root, or, for a linked worktree, for its main repository.
  - `busy`: the server is already running a request. It serves one at a time; a later slice may run more than one server.
  - `request_too_large` and `invalid_request`.

## Client behavior

- The client runs in the hook launcher, before it imports the 6.9 MB bundle; otherwise the bundle load alone exceeds the 200 millisecond target. Moving it there changes the launcher contract and ships reader-first.
- It connects with a 150 millisecond connect timeout and waits at most 50 milliseconds for `A`. Before `C`, it waits no longer than the remaining budget minus a reserve for the in-process path (at most 1 second in slice 1).
- On `declined`, no listener, a missing `A`, or a timeout or reset before it sent `G`, it closes the connection, runs the in-process path, and records the cause as a stage outcome: `context_socket_<reason>`, `context_socket_unreachable`, or `context_socket_unacknowledged`.
- After it sent `G`, it waits for the answer until the hook's hard limit and does not fall back. If the answer never comes, it prints `{}`, and the server's records stand. This window is one local write, so it is lost only if the server dies within it.
- On `ok` it writes the response's streams and exits with its code.
- It never retries the socket within one invocation.

## Host behavior

- The server runs `runTerminalHookCommand` for one request at a time. For that request it sets its working directory to the root and its environment to the request's values, and it starts the hook budget from the request's `deadline`, so the code sees what the hook process would have seen. Tools found through `PATH`, such as Git and provider CLIs, are resolved from the server's environment, which the host gives its login `PATH`.
- Session identity comes only from the input, never from the host's environment.
- The first durable write of a request waits for the handshake's `G`. A contract test fails if any write on the prompt path can happen before it.
- The in-process hook relies on its process exit to drop work a deadline abandoned. The server answers a request that reached a deadline and then exits, and the host starts a fresh server, so abandoned work never runs into the next request.
- Request failures are reported by closed code only. No request body, parse excerpt, or provider input reaches a log.

## Privacy

- Prompt text crosses the socket in memory only. The host never writes a request to disk and logs no request body. The events it records are the ones the in-process hook already records.
- On Unix, only processes of this user can connect, because the socket and its directory are owner-only.

## Failure meaning

- A missing or unreachable listener means the hook works as before. It is not an error and raises no attention.
- A `runtime_mismatch` that persists after an upgrade means the host did not restart its server.
- Socket stage outcomes are recorded with the existing stage observations, and the host records the client's `elapsed` with its own, so `lervo terminal budget` reports end-to-end time, how often prompts fell back, and why.

## Slice 0 results

Measured on the Mac on 2026-11-25 (load average 7 to 9), in one long-lived process against this repository:

- Today's snapshot capture, which reads and rewrites a 2.3 MB stat cache on disk, took 365 to 493 milliseconds.
- An in-memory snapshot took 3.8 seconds the first time. Warm, it still took 184 to 376 milliseconds, because it stats every file.
- Opening the project storage took 2 to 17 milliseconds, and the current workstream read on open storage took 37 to 44 milliseconds.

A long-lived process therefore saves the Node startup (about 0.25 seconds), the stat cache input and output (about 0.1 seconds), and repeated module loading. The stat walk itself remains. The 200 millisecond target needs a snapshot the host keeps current from repository watch events without walking every file, and slice 2 must settle how a request knows that no change is still pending in the watch.

## Slices

0. **Measure the gain.** In one long-lived process on the Mac and WSL hosts, time repeated prompt preparation against this repository, cold and warm, and with an in-memory repository snapshot that a watch keeps current. Record which stages remain. Build the channel only if the warm path is well under the in-process path.
1. **Prompt over the socket, Unix only:**
   - the supervised server process and its serve mode in the hook runtime;
   - the launcher client with the commit handshake and fallback;
   - the closed declines and the environment contract;
   - stage outcomes, including end-to-end time. Linked worktrees of a hosted repository are served with their own root. Acceptance: on an idle host a served prompt costs the launcher plus one round trip; every fallback cause appears in the stage observations; an ADE-hosted worktree session and a terminal session both get output identical to the in-process path.
2. **Warm state in the server:** an in-memory repository snapshot kept current by a repository watch, and pooled storage. The snapshot must not miss a change made just before the prompt: Stop attributes the difference between the prompt-time and Stop-time snapshots to the turn. A request therefore re-validates the snapshot before use, or the slice defines how a pending watch event is drained first. Acceptance: ADR-0562's prompt hook p95 under 200 milliseconds end to end on the Mac and WSL hosts.
3. **Stop over the socket**, with the same fallback.
4. **Record after answering, and the cached base.** The order guarantees of ADR-0548 and ADR-0549 are restated for events the host commits after the hook returns. When the host is unreachable, the hook prints the last cached base block and records `host_unreachable`, as ADR-0562 states.
5. **Windows:** a pipe whose server the client authenticates before sending.
