# Resident context socket

[ADR-0562](../../../../decisions/foundation/0562-one-relation-web-one-context-assembler-and-a-stop-ledger.md) section 4 makes the terminal hook a thin client of the resident knowledge host. This page defines that channel and the order in which it lands. Until a slice below lands, the hook keeps preparing context in its own process, as [compact assembly](compact-assembly.md) and [runtime dispatch](runtime-dispatch.md) describe.

## Why

On 2026-11-25, with v0.47.8 on the Mac, a prompt hook spent:

- about 0.25 seconds starting Node, loading and verifying the bundle, and parsing the input;
- 0.7 to 2.2 seconds in its stages, mostly the repository snapshot walk (0.2 to 0.9 seconds) and the reads that open the project storage.

ADR-0562 sets the target: a prompt hook p95 under 200 milliseconds end to end. A long-lived process alone does not reach it: in a warm process the snapshot walk still costs 0.7 to 0.9 seconds, because each capture re-reads its stat cache and stats every file. The gain comes from state the host keeps between prompts. Slice 0 measures that before the channel is built.

## Deviations from ADR-0562

- The hook sends its raw provider input instead of only the prompt and transcript position, so the host runs exactly the code the hook would.

## Channel

- **Server:** a context server process that the host's release follower service spawns and supervises, one per host. Only a follower run with the service configuration (`lervo host upgrade --follow --apply --config`) runs one, and only after it takes the follower lock, so a second follower that loses the lock never takes over the socket; a follow run without `--config`, a knowledge host, or a test runs none. Every host that installs Lervo runs the follower, including hosts whose repositories are served by Node services and run no knowledge host service, so every host serves prompts. The server runs the installed hook runtime, the same file the hook launcher verifies and loads, as `runtime-v2.mjs context-server`, so the server and the hook run identical code by construction. Being its own process, it:
  - has its own process id, so checks that treat the current process id as proof that a lock or journal belongs to someone else stay correct;
  - cannot be held by a resident cycle that blocks the host's event loop;
  - can be stopped and restarted to drop work a deadline abandoned.
- **Supervision:** the follower starts the server when its loop starts, after each follow cycle, and once a minute, and only from a runtime that has the server mode; a runtime from before it would treat `context-server` as hook arguments, as happens for a moment while an upgrade moves the pointer. A server that exits restarts after 200 milliseconds, doubling up to one minute while it keeps failing, and at 200 milliseconds again after it ran for a minute. A server that ignores SIGTERM for three seconds is killed. A server whose follower died exits when its parent channel disconnects, so it never serves beside the next follower's server. Each check compares the current runtime pointer with the one the server runs, so the cycle that applies an upgrade replaces the server, and a pointer moved by another writer is noticed within a minute. A crash's trace reaches the follower's log.
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
  - `version`: 1, and `kind`: `prompt` for `UserPromptSubmit` or `stop` for `Stop`. The client parses the input first and sends only those two; `SessionStart` and the workspace recording hooks stay in process. The server declines a request whose input names another event than its kind as `invalid_request`, so a request runs exactly the hook its kind names.
  - `runtime`: the content hash the store's pointer names, which is the runtime the launcher would load.
  - `cwd`: the realpath of the hook's working directory. The served hook resolves the repository, a linked worktree's execution and evidence roots, and everything else from it, as the in-process hook does.
  - `args`: the launcher's arguments, which carry the provider and the contract.
  - `environment`: the values of every variable the hook path reads that can change what it prints or records: `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `HOME`, `LERVO_USER_CAPABILITY_ROOT`, `LERVO_USER_STATE_DIRECTORY`, `LERVO_WORKSPACES_HOME`, `XDG_CONFIG_HOME`, and `XDG_STATE_HOME`. The list is closed; a test keeps the launcher's copy equal to the server's. The server compares what each value means: an unset variable stands for its default, so a service that sets `LERVO_USER_STATE_DIRECTORY` to the default path matches a session that leaves it unset.
  - `elapsed`: the client's time spent so far, in milliseconds. The served hook's budget and its recorded `total` include it.
  - `input`: the provider's hook input exactly as read from standard input, at most 200 KiB; a larger input, such as a Stop with a long final message, stays in process.
  - `session`: the session's values the served hook runs with (see Session environment). Older clients omit it, and the hook then runs with the server's values.
  - `umask`: the session's file mode creation mask, which the served hook's writes use. Older clients omit it.
- **Response** (`terminal.context.response`, version 1):
  - `ok`, with `stdout`, `stderr`, and `exitCode`: what the in-process hook would have produced. The client writes both streams and exits with that code.
  - `launches`: the detached processes the hook asked for, each an entry, its arguments, its working directory, and the variables it needs beyond the session's own. The client starts them (see Detached launches).
  - `declined`, with `reason`, always sent before `A`, so nothing was recorded.
- **Decline reasons** (closed for version 1):
  - `runtime_mismatch`: the server's runtime hash differs from the request's, as during an upgrade.
  - `environment_mismatch`: a value in `environment` differs from the server's.
  - `busy`: the server is already running a request. It serves one at a time; a later slice may run more than one.
  - `request_too_large` and `invalid_request`.

## Session environment

The compared variables choose which stores a hook reads, so a difference declines the request. Other variables change only how the hook's child processes behave, and a service's values differ from a terminal session's. The served hook runs with the session's values of those instead:

- `PATH`, where `git`, `launchctl`, `systemctl`, and `ps` are found.
- `XDG_RUNTIME_DIR` and `DBUS_SESSION_BUS_ADDRESS`, which decide on Linux whether Stop's replica service inspection can reach the user's service manager. A service has them where an SSH session may not, so Stop would otherwise record a different lifecycle result.
- Every `GIT_` variable, which redirects Git; a `GIT_` variable only the server has is removed for the request.
- The file mode creation mask. The service runs with `0077`, which keeps the socket private, while a session's files are usually `0644`.

The server serves one request at a time, so it applies these to its own process for the request and restores its own values once the hook's leftover work drained. Provider variables such as `CLAUDE_PROJECT_DIR` are not carried: neither hook reads them.

## Detached launches

A hook starts detached workers: the knowledge worker and the next prompt's prefetch after a Stop, and the interrupted-turn settlement worker after any hook. Started by the server, they would belong to the service: a service manager stops them with it, systemd by its whole control group, and they would get the service's environment, which lacks shell-only variables such as provider credentials and proxies, its Node, and its mask. The served hook therefore hands each launch to its answer instead of starting it, and the client starts it, detached, with its own Node and environment plus the variables the launch names, exactly as an in-process hook would. A launch asked for after the answer went out, by work a deadline abandoned, fails, as a failed launch does; its queued work waits for the next hook or the resident. Only a client that sends `session` starts launches: an older client ignores them, so its hook starts them in the server, as slice 1 did. A hook answered before its records (ADR-0636) asks for some launches after the client has its answer. A client that sends `relay: true` then passes its connection to a detached relay before it exits: the answer carries `pending: true`, the server sends `{"launches": [...]}` on a second line when the records finish, and the relay starts them from the session and exits, giving up after 30 seconds. A client that does not relay gets those launches started in the server, with the session's values applied.

## Launcher delegation

A repository commits a copy of the launcher, and the host keeps its own at `~/.lervo/terminal-hooks/launcher.mjs`, which every CLI install replaces with its bundled launcher. The committed copy hands the hook to the host's launcher, in the same process, when:

- the host's launcher is this user's regular file, and neither it nor the store grants any permission to group or others;
- its `launcherVersion` is at least the copy's own. An older host install never runs a repository's hooks with an older launcher, and the runtime both launchers load is the same store runtime;
- `LERVO_TERMINAL_HOOK_DELEGATION` is not `0`, and the platform is not Windows.

Otherwise the copy runs itself, exactly as before, so a clone without Lervo, a CI runner, or a host whose store is unreadable behaves as it did. The host's launcher never hands the hook off again. A launcher change therefore reaches every repository through the CLI install; a repository's copy needs rewriting only when the delegation rule itself changes. Each served request names the launcher that sent it, and `context-stats.json` counts served prompts by launcher.

## Client behavior

- The client runs in the hook launcher, before it loads the 6.9 MB runtime bundle; otherwise the bundle load alone exceeds the 200 millisecond target. It touches nothing unless the store holds a socket or a [cached base](#cached-base) for the hook, so a host without a server behaves exactly as before, and a newer launcher pulled onto a host with an older CLI keeps working.
- It reads the hook input, then makes it readable again for the runtime, so a fallback, or an older runtime, reads the same input.
- It connects with a 150 millisecond timeout and waits at most 500 milliseconds for `A`. Launcher version 4 waited 100 milliseconds: on 2026-11-26, on a Mac with 24 GB of memory and 27.7 GB of swap in use, 17 of the first 35 hook stage observations at writer schema 13 recorded `unreachable`, and an idle server sent `A` after 158–2,200 ms in 4 of 60 probes while its pages came back. A hook that falls back loads the whole runtime cold in its own process, so waiting for a server that is paging back in is cheaper.
- On a declined line, no listener, a missing `A`, or an error before it sent `G`, it closes the connection. A prompt then gets the [cached base](#cached-base) when one stands for it; otherwise the launcher runs the in-process path.
- After it sent `G`, it waits up to 25 seconds, the provider's hook limit, and does not fall back. If the answer never comes, it prints `{}`, as a failed hook does, and the server's records stand.
- On `ok` it starts the response's launches, then writes the response's streams and exits with its code. The socket closing after the answer arrived changes nothing.
- It never retries the socket within one invocation. `LERVO_TERMINAL_CONTEXT_SOCKET=0` keeps a hook in process.

## Host behavior

- The server runs `runTerminalHookCommand` for one request at a time, with the request's working directory, input, and arguments, and with the hook's start moved back by the client's `elapsed`. The hook path reads its working directory only from that input, never from the process.
- Session identity comes only from the input, never from the host's environment.
- The in-process hook relies on its process exit to drop work a deadline abandoned. A stage that fails or reaches its deadline settles its measurement, and the hook answers, possibly degraded, while sibling stages' work may still run. After answering, the server therefore waits for every stage's own work to settle and serves no other request meanwhile; a prompt that arrives then is declined as `busy` and prepared in process. When that work does not settle within 250 milliseconds, or the request ran past half the budget, the server exits and the host starts a fresh one, which it does within a fraction of a second, so abandoned work never runs into the next request. A request that never settles makes the server exit after the hook budget plus five seconds. On SIGTERM or SIGINT, or when its follower disconnects, the server stops accepting and removes its socket at once, so later hooks run in process, and exits once the hook in flight answered and drained. A connection it already answered with `A` is kept until its `G` arrives or its commit wait ends, because that client no longer falls back. A Stop cut off mid-run would lose its decision and leave its records half written, which an in-process hook never risks from a Lervo upgrade. A service manager signals the server and its follower together, and the follower signals it again, so later signals leave the first one's finish running. The supervisor waits up to the hook budget, 15 seconds, before it kills a server that has not exited, which stays below launchd's default 20-second exit timeout for the follower.
- A Stop holds the server like a prompt does, so another session's prompt that arrives meanwhile is declined as `busy` and prepared in process. Stop's replica service inspection runs `ps` and `sysctl` synchronously, which can hold the server's event loop long enough that another client's 150 and 100 millisecond waits expire; that client also runs in process.
- The server keeps the checkouts it served in the last 30 minutes warm. While no request holds it, it prepares the latest one's context every minute without recording anything, and right after it starts it does so for the four most recent checkouts it remembers in `context-warmth.json` beside its socket, a 0600 file that holds their paths only. A request that arrives meanwhile is served at once and shares the process with that preparation. On 2026-11-26 the Mac's first prompt after a server restart took 9.8 s, and an idle server paged out under memory pressure took up to 2.2 s to accept a request; a warm preparation of this repository takes about 130 ms after a 1.4 s first one.
- The recorded stage observations name the server's Node version and architecture, which are the session's on a host with one Node install.
- Request failures are reported by closed code only. No request body, parse excerpt, or provider input reaches a log.

## Cached base

[ADR-0645](../../../../decisions/execution/providers/hooks/0645-answer-an-unserved-prompt-from-the-cached-base.md) answers a prompt the server could not take from the checkout's cached base.

- **Server.** Once a served prompt has drained and its relayed launches went out, the server keeps that checkout's base while it stays busy. While that checkout's base is fresh and no delivery marker waits, it stats the base, lists the directory, and stops. Otherwise it records the checkout's delivery markers, and then rewrites `base/<key>.json` beside its socket if that file is missing or at least five minutes old. At most hourly it also removes files in the base directory older than 24 hours, whatever checkout they name. Each step's failure is contained, so a busy store never keeps the base from being refreshed.
  - The file holds the exact prompt answer, with a notice that it is the cached base, when it was prepared, and that the turn records no context.
  - `<key>` digests the request's working directory, its arguments, and the JSON array of the compared variables. An unset variable is `null`, kept apart from an empty one, as the server's comparison does.
  - A checkout that a workspace claims gets no base, and the server removes any it finds there.
  - Preparation gets one second. A base whose owner rules did not load in that time is not written, and a `<key>.retry` file makes the checkout wait five minutes before the next attempt, as it does after a base that could not be written. Files are synced before they replace another. A read that reached the deadline may still be running, so the server then exits, as after an overrun.
  - The workspace claim is checked when the base is due for a refresh.
  - This work runs with the server's own environment, after the session's values were restored. A session that redirects Git with `GIT_DIR` may therefore get its base from the checkout its working directory names.
- **Launcher.** After an offer fails as `no_server`, `unreachable`, or `declined_busy`, launcher version 6 looks for `base/<key>.json`. It needs a file that grants nothing to group or others and is less than 30 minutes old, allowing one second for a modification time that runs ahead of the clock. Only then does it read the hook input. For a prompt it then prints the file and exits 0 without loading the runtime. It leaves two markers: `<key>.<ms>.<pid>.unserved` with the reason and the cache's age, and `<session>.turn` for the session. Any other decline, a Stop, or a missing, old, or exposed file runs in process as before.
- **Stop.** Some Stops carry no turn digest, such as Claude's. If the session's turn file is newer than the session's latest prepared context, such a Stop records nothing and answers `{}`; otherwise it would observe the earlier turn again and record that turn's changes twice. If the owner interrupted that earlier turn, its open-turn marker stays, and the next prepared prompt or session start settles it as usual. A Stop that names its turn already matches only its own turn's context, so it skips this check.
- **Records.** At writer schema 14 the server records each marker as `terminal.context.base_delivered` with `actor.kind: system` and fresh unattributed coordinates, at most 32 per prompt. It leaves an empty marker younger than 10 seconds for the next prompt, because the launcher may still be writing it. Before recording, the server writes a random identity into each marker, so a marker that survived its record is not recorded twice and no identity reveals the checkout. A marker is removed once it is recorded, or unrecorded when it is malformed or a day old; a busy store only delays it. Below schema 14 it removes markers without recording them. See the [payload contract](../../events-and-privacy/event-envelope-compatibility/payload-contracts/terminal-context-base-delivered.md).

## Privacy

- Prompt text, a Stop's final message, and the session's carried variables cross the socket in memory only. The host never writes a request to disk and logs no request body. The events it records are the ones the in-process hook already records. Provider credentials and other variables outside the session list never cross it: a launch gets them from the client's own environment.
- On Unix, only processes of this user can connect, because the socket and its directory are owner-only.
- A cached base holds what the base context already shows: the AGENTS.md pointer, publication policy, applied owner rules, and the workstream headline. It sits in the owner-only store as an owner-only file. Delivery markers hold a closed reason and an age; turn files are empty and named by a digest of the provider session ID.

## Failure meaning

- A missing or unreachable listener means the hook works as before. It is not an error and raises no attention.
- A `runtime_mismatch` that persists after an upgrade means the host did not replace its server.
- A served hook records the same stage observations as an in-process one; its `total` includes the client's time. The server keeps its counts since it started in `context-stats.json` beside its socket: hooks served, by launcher and by kind (`servedKinds`), requests declined by reason, the last served time, and `answerMilliseconds`: per kind, the count of answers and the p50, p95, and last of the latest 100 answer latencies, each from the client's start to the answer leaving the server. Since ADR-0636 a stage observation's `total` includes the records that follow an early answer, so these latencies are the ones the provider waited for. It holds counts and times only, so a canary reads directly whether prompts were served. Once a repository's writer selects schema 13, each stage observation also says per hook how it was delivered: a served hook's answer time when it answered before its records, or the closed reason a hook ran in process ([hook delivery](../../events-and-privacy/event-envelope-compatibility/payload-contracts/execution-stages-observed.md#hook-delivery-schema-13)). For that, launcher version 4 leaves the runtime its offer's outcome in memory: whether it found no socket, then, once it offered, the connection state it gave up in or the server's decline line.

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
3. **Stop over the socket**, with the same fallback, the session environment, detached launches started by the client, and a server that finishes the hook in flight before it stops. In an isolated end-to-end run against this repository on the Mac, a served Stop took 41–182 milliseconds against 238–402 milliseconds in process, with identical output. That run's prompts degraded, so its Stops found no prepared turn; the full Stop path is verified on the hosts after release.
4. **Record after answering, and the cached base.** Recording after answering landed with [ADR-0636](../../../../decisions/execution/providers/hooks/0636-answer-a-served-prompt-before-recording-it.md): a served prompt is answered once its context is prepared, and the server records it afterwards while it stays busy. On a copy of this repository the records it no longer waits for took 40 ms at the median and 75 ms at p90 in `event_commit` alone. [ADR-0645](../../../../decisions/execution/providers/hooks/0645-answer-an-unserved-prompt-from-the-cached-base.md) decides the cached base: the server keeps each checkout's base current, and the launcher prints it for a prompt the server could not take as `no_server`, `unreachable`, or `declined_busy`. It landed with launcher version 6 and writer target 14: see [Cached base](#cached-base).
5. **Windows:** a pipe whose server the client authenticates before sending.
