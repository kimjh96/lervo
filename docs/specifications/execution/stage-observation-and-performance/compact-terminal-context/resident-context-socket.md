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

- **Server:** a context server process that the resident knowledge host spawns and supervises while it holds the host resident lock. Only the host resident service (`lervo knowledge host --config`) runs one; a manual `lervo knowledge host` or a test never takes over the socket. The server runs the installed hook runtime, the same file the hook launcher verifies and loads, as `runtime-v2.mjs context-server`, so the server and the hook run identical code by construction. Being its own process, it:
  - has its own process id, so checks that treat the current process id as proof that a lock or journal belongs to someone else stay correct;
  - cannot be held by a resident cycle that blocks the host's event loop;
  - can be stopped and restarted to drop work a deadline abandoned.
- **Supervision:** the host starts the server when it takes the lock and after each scan, and only from a runtime that has the server mode; a runtime from before it would treat `context-server` as hook arguments, as happens for a moment while an upgrade moves the pointer. A server that exits restarts after 200 milliseconds, doubling up to one minute while it keeps failing, and at 200 milliseconds again after it ran for a minute. A server that ignores SIGTERM for three seconds is killed. A server whose host died exits when its parent channel disconnects, so it never serves beside the next host's server. The runtime pointer is one of the inputs a scan watches, so an upgrade rescans and replaces the server; a server never outlives an upgrade. A crash's trace reaches the host's log.
- **Address, Unix:** the socket `context.s` in the terminal hook runtime store (`~/.lervo/terminal-hooks`). The server creates it owner-only, with no window before its mode is set, and the client connects only when the store itself grants no permission to group or others. The server listens on the name relative to the store; the client connects by its full path, so a home directory too deep for a socket path (about a hundred bytes) keeps hooks in process. A starting server removes a leftover socket, and a stopping server removes the socket only if it is still the one it bound; a hook never removes it.
- **Windows:** no listener before an authenticated channel exists. A named pipe name shares one machine-wide namespace, so another local user could create it first and receive prompt text. Windows hooks always prepare context in process until a slice adds a server proof (a key in an owner-only file).
- **Framing:** one request per connection, with a commit handshake so a prompt is recorded once:
  1. The client writes one line of JSON.
  2. The server checks it and writes either a declined line or `A`.
  3. The client writes `G` only while it can still wait for the answer. After `G` it never falls back.
  4. Only after `G` does the server start the hook, so nothing is recorded for a client that left. It writes one line of JSON, and both sides close.
  - A server that does not receive `G` within one second abandons the request; nothing ran for it.
  - Either side drops a line over 256 KiB.

## Request and response

- **Request** (`terminal.context.request`, version 1):
  - `version`: 1, and `kind`: `prompt`. The client parses the input first and sends only `UserPromptSubmit`; `SessionStart`, `Stop`, and the workspace recording hooks stay in process.
  - `runtime`: the content hash the store's pointer names, which is the runtime the launcher would load.
  - `cwd`: the realpath of the hook's working directory. The served hook resolves the repository, a linked worktree's execution and evidence roots, and everything else from it, as the in-process hook does.
  - `args`: the launcher's arguments, which carry the provider and the contract.
  - `environment`: the values of every variable the hook path reads that can change what it prints or records: `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `HOME`, `LERVO_USER_CAPABILITY_ROOT`, `LERVO_USER_STATE_DIRECTORY`, `LERVO_WORKSPACES_HOME`, `XDG_CONFIG_HOME`, and `XDG_STATE_HOME`. The list is closed; a test keeps the launcher's copy equal to the server's. The server compares what each value means: an unset variable stands for its default, so a service that sets `LERVO_USER_STATE_DIRECTORY` to the default path matches a session that leaves it unset.
  - `elapsed`: the client's time spent so far, in milliseconds. The served hook's budget and its recorded `total` include it.
  - `input`: the provider's hook input exactly as read from standard input, at most 200 KiB; a larger input stays in process.
- **Response** (`terminal.context.response`, version 1):
  - `ok`, with `stdout`, `stderr`, and `exitCode`: what the in-process hook would have produced. The client writes both streams and exits with that code.
  - `declined`, with `reason`, always sent before `A`, so nothing was recorded.
- **Decline reasons** (closed for version 1):
  - `runtime_mismatch`: the server's runtime hash differs from the request's, as during an upgrade.
  - `environment_mismatch`: a value in `environment` differs from the server's.
  - `busy`: the server is already running a request. It serves one at a time; a later slice may run more than one.
  - `request_too_large` and `invalid_request`.

## Launcher delegation

A repository commits a copy of the launcher, and the host keeps its own at `~/.lervo/terminal-hooks/launcher.mjs`, which every CLI install replaces with its bundled launcher. The committed copy hands the hook to the host's launcher, in the same process, when:

- the host's launcher is this user's regular file, and neither it nor the store grants any permission to group or others;
- its `launcherVersion` is at least the copy's own. An older host install never runs a repository's hooks with an older launcher, and the runtime both launchers load is the same store runtime;
- `LERVO_TERMINAL_HOOK_DELEGATION` is not `0`, and the platform is not Windows.

Otherwise the copy runs itself, exactly as before, so a clone without Lervo, a CI runner, or a host whose store is unreadable behaves as it did. The host's launcher never hands the hook off again. A launcher change therefore reaches every repository through the CLI install; a repository's copy needs rewriting only when the delegation rule itself changes. Each served request names the launcher that sent it, and `context-stats.json` counts served prompts by launcher.

## Client behavior

- The client runs in the hook launcher, before it loads the 6.9 MB runtime bundle; otherwise the bundle load alone exceeds the 200 millisecond target. It touches nothing unless the store holds a socket, so a host without a server behaves exactly as before, and a newer launcher pulled onto a host with an older CLI keeps working.
- It reads the hook input, then makes it readable again for the runtime, so a fallback, or an older runtime, reads the same input.
- It connects with a 150 millisecond timeout and waits at most 100 milliseconds for `A`.
- On a declined line, no listener, a missing `A`, or an error before it sent `G`, it closes the connection and runs the in-process path.
- After it sent `G`, it waits up to 25 seconds, the provider's hook limit, and does not fall back. If the answer never comes, it prints `{}`, as a failed hook does, and the server's records stand.
- On `ok` it writes the response's streams and exits with its code.
- It never retries the socket within one invocation. `LERVO_TERMINAL_CONTEXT_SOCKET=0` keeps a hook in process.

## Host behavior

- The server runs `runTerminalHookCommand` for one request at a time, with the request's working directory, input, and arguments, and with the hook's start moved back by the client's `elapsed`. The hook path reads its working directory only from that input, never from the process.
- Session identity comes only from the input, never from the host's environment.
- The in-process hook relies on its process exit to drop work a deadline abandoned. A stage that fails or reaches its deadline settles its measurement, and the hook answers, possibly degraded, while sibling stages' work may still run. After answering, the server therefore waits for every stage's own work to settle and serves no other request meanwhile; a prompt that arrives then is declined as `busy` and prepared in process. When that work does not settle within 250 milliseconds, or the request ran past half the budget, the server exits and the host starts a fresh one, which it does within a fraction of a second, so abandoned work never runs into the next request. A request that never settles makes the server exit after the hook budget plus five seconds. On SIGTERM the server exits at once, without waiting for a request in flight.
- Request failures are reported by closed code only. No request body, parse excerpt, or provider input reaches a log.

## Privacy

- Prompt text crosses the socket in memory only. The host never writes a request to disk and logs no request body. The events it records are the ones the in-process hook already records.
- On Unix, only processes of this user can connect, because the socket and its directory are owner-only.

## Failure meaning

- A missing or unreachable listener means the hook works as before. It is not an error and raises no attention.
- A `runtime_mismatch` that persists after an upgrade means the host did not replace its server.
- A served prompt records the same stage observations as an in-process one; its `total` includes the client's time. The server keeps its counts since it started in `context-stats.json` beside its socket: prompts served, prompts declined by reason, and the last served time. It holds counts and times only, so a canary reads directly whether prompts were served. Recording which prompts fell back, and why, needs new stage outcomes, whose enums are closed: it waits for a reader-first schema change.

## Slice 0 results

Measured on the Mac on 2026-11-25 (load average 7 to 9), in one long-lived process against this repository:

- Today's snapshot capture, which reads and rewrites a 2.3 MB stat cache on disk, took 365 to 493 milliseconds.
- An in-memory snapshot took 3.8 seconds the first time. Warm, it still took 184 to 376 milliseconds, because it stats every file.
- Opening the project storage took 2 to 17 milliseconds, and the current workstream read on open storage took 37 to 44 milliseconds.

A long-lived process therefore saves the Node startup (about 0.25 seconds), the stat cache input and output (about 0.1 seconds), and repeated module loading. The stat walk itself remains. The 200 millisecond target needs a snapshot the host keeps current from repository watch events without walking every file, and slice 2 must settle how a request knows that no change is still pending in the watch.

## Slice 1 results

Measured on the Mac on 2026-11-25 (load average 5 to 11) against a local clone of this repository with a copy of its event store and state, six prompts each:

- In process, a prompt hook took 667 to 884 milliseconds end to end; served, 349 to 417 milliseconds. The output was byte-identical.
- Inside the hook, the repository snapshot remained the largest stage, 190 to 280 milliseconds when served. Slice 2 targets it.
- Two alternatives showed no gain over the measurement noise and were not kept: asking for a directory's file stats in parallel, and a larger libuv thread pool for the server.

## Slices

0. **Measure the gain.** In one long-lived process on the Mac and WSL hosts, time repeated prompt preparation against this repository, cold and warm, and with an in-memory repository snapshot that a watch keeps current. Record which stages remain. Build the channel only if the warm path is well under the in-process path.
1. **Prompt over the socket, Unix only:** the supervised server and its serve mode in the hook runtime, the launcher client with the commit handshake and fallback, and the closed declines and environment. Landed; see the slice 1 results.
2. **A faster snapshot:** the repository snapshot is the largest remaining stage. The snapshot must not miss a change made just before the prompt: Stop attributes the difference between the prompt-time and Stop-time snapshots to the turn. A watch kept current by file events would have to be drained before each prompt, by writing a marker file and waiting for its event; on the Mac under load that round trip took 70 to 875 milliseconds, longer than walking every file, so the snapshot does not use a watch. Walking directories concurrently while recording files in the same order cut a warm capture of this repository from about 180–250 milliseconds to 115–150 milliseconds, with identical revisions. It landed with the snapshot's deadline and read-bound guarantees restated for concurrent reads in [terminal preparation and snapshots](../terminal-preparation-and-snapshots.md). Acceptance: ADR-0562's prompt hook p95 under 200 milliseconds end to end on the Mac and WSL hosts.
3. **Stop over the socket**, with the same fallback.
4. **Record after answering, and the cached base.** The order guarantees of ADR-0548 and ADR-0549 are restated for events the host commits after the hook returns. When the host is unreachable, the hook prints the last cached base block and records `host_unreachable`, as ADR-0562 states.
5. **Windows:** a pipe whose server the client authenticates before sending.
