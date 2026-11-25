# Lervo ADE session-host protocol

Status: `proposed`
As of: 2026-11-23

This specification defines version 1 of the protocol between the ADE interface (the client) and the session host. `@lervo/session-host-contract` holds its JSON Schema. The TypeScript types and the Rust types are generated from that schema, and both sides decode the same fixtures in contract tests. The [sessions specification](ade-sessions.md) defines the sessions, events, and failure meanings this protocol carries.

## Transport

- The transport is an ordered, reliable byte stream that only the owning OS user can open: a Unix domain socket on macOS, Linux, and WSL, and a named pipe on Windows. Between a Windows interface and a WSL session host, it is a loopback TCP connection.
- A later remote transport carries the same frames. Nothing in the protocol depends on the transport.
- The client is the Tauri shell. The webview cannot open the socket, so the shell relays messages to it over Tauri's IPC:
  - The shell decodes and validates each control message and passes it to the webview as JSON. The webview therefore never parses MessagePack and never sees an unvalidated message, and it ships no validator.
  - Terminal frames reach the webview unchanged as `[channel: u32][sequence: u64][bytes]` over a binary IPC channel.
  - When the socket does not answer, the shell starts `lervo-session-host serve` detached, so it outlives the window, and connects again. It looks for the session host in `LERVO_SESSION_HOST` or beside its own executable, where a bundle built with `pnpm --filter @lervo/ade bundle` carries it, and passes on the login shell's `PATH`, because an application opened from the Dock inherits a minimal one.
  - After each handshake, the shell sends the webview `host.identified` with `hostVersion` from the session host's `welcome`, `appVersion`, its own version, and `replaceable`, whether it knows the session host's process. The socket reports that process as its peer; the process ID never reaches the webview.
  - **Replacing an older session host.** The session host outlives the window, so a newer application can meet the session host an older one started. When `hostVersion` is older than `appVersion` and the session host is replaceable, the interface offers to restart it and says that working agents stop and that each conversation continues when it is opened again. It never restarts without the user's choice: the session host's sessions end with it, and nothing tells the interface when it has heard every running session's status. On the choice, the shell's `host_replace` sends the session host SIGTERM, which ends its providers as any shutdown does and removes its socket, and the next connection starts the session host beside the shell. An older application leaves a newer session host alone. `host_replace` fails with `host_replace_unavailable` when the live connection names no process, including a second call, and with `host_replace_failed` when the signal cannot be sent.
  - The webview reconnects after each disconnection, waiting 0.5 s and then twice as long after each failure, up to 10 s. While connected, no timer runs.

## Contract and validation

- The schemas live in `packages/session-host-contract/src/`, one module per concern. `pnpm --filter @lervo/session-host-contract build` writes them as one JSON Schema document to `packages/session-host-contract/generated/session-host-protocol.schema.json`. A contract test fails when the committed document is stale.
- The Rust crate `lervo-session-protocol` generates its types from that document with `typify` at build time and embeds the document for validation.
- Each side validates every received control message against the document before it uses the message: AJV in TypeScript, `jsonschema` in Rust. Validation errors name the location and the rule, never the value.
- `packages/session-host-contract/test/fixtures/` holds valid client messages, valid host messages, and invalid messages. Both sides must accept, round-trip, and reject the same fixtures.

## Frames

Every frame is `[length: u32, big-endian][kind: u8][payload]`. The length counts the kind byte and the payload, and a frame is at most 1 MiB. Larger content is split across frames.

| Kind | Name     | Payload                                                                                              |
| ---- | -------- | ---------------------------------------------------------------------------------------------------- |
| 1    | Control  | One MessagePack-encoded message that validates against the protocol schema                           |
| 2    | Terminal | `[channel: u32][sequence: u64][bytes]`, raw PTY bytes for the channel that `session.opened` assigned |

Terminal bytes travel as raw frames, so they are never base64-encoded or copied into a message. The client sends keystrokes for the CLI conversation as terminal frames in the other direction. A frame of unknown kind closes the connection with `frame_kind_unknown`.

## Handshake

1. The client sends `hello` with the protocol versions it supports, its name and version, and the connection token.
2. The session host replies `welcome` with the chosen protocol version and its own identity, or `rejected` with `protocol_unsupported` or `token_invalid` and then closes the connection.
3. Before `welcome`, the session host accepts no other message.

The session host writes a new 256-bit token at each start to an owner-only file in its host state directory, and the interface reads it there. A remote transport later replaces where the token comes from, not the handshake.

## Host state directory

One session host runs per OS user. Its owner-only directory is `~/Library/Application Support/dev.lervo.ade` on macOS and `$XDG_STATE_HOME/lervo-ade` (or `~/.local/state/lervo-ade`) on Linux and WSL. `LERVO_SESSION_HOST_DIR` names another directory, so an isolated session host can serve beside the user's own, as tests and the interface harness do. The shell and the session host both read it, so a shell started with it reaches, and when needed starts, that session host. It holds:

- `session-host.lock`, an exclusive lock held while the session host serves. A second instance finds it held and exits successfully, so the client can start the session host without first checking for one;
- `session-host.sock`, the socket, at mode 0600. A socket file left by a session host that no longer runs is replaced at start;
- `connection-token`, the token, at mode 0600;
- `conversations/`, one conversation index per native session;
- `diagnostics.log` and `diagnostics.log.1`, the diagnostics log at mode 0600 (see "Privacy and failure").

The session host removes the socket and the token when it shuts down. Its sessions end with it.

## Sequencing and resumption

- Every session message that changes state carries a per-session `sequence`, a positive integer that only grows.
- One counter per session orders its status changes, conversation messages, and terminal frames.
- A client records the last sequence it applied. After a reconnection, `session.attach` with `afterSequence` makes the session host send what the client missed, then the current status:
  - for the CLI conversation, the scrollback after that sequence that it still holds;
  - for the native conversation, the item that is still streaming, if any. The client loads the items it missed with `conversation.range` after its last item. Clients keep items by `itemId`, so an item that arrives twice replaces itself.
- `session.open` returns the workspace's running session, with its terminal channel, when the session runs in the requested mode or no mode is named. When it runs in the other mode, the session host stops it, waits up to 5 seconds for the provider to exit, and asks the core for a launch in the requested mode. For a provider that resumes, that launch continues the same session. Only then does it ask the core, so one provider process serves each workspace.
- `sessions.watch` makes the session host send the latest `session.status` of every session it holds, and then each status change, to that connection until it closes. The workspace list uses it, so it shows live status without receiving any session's output.
- An ended session still answers `session.attach` and `conversation.range` for 10 minutes, keeping the last 256 KiB of its CLI output. At most 32 ended sessions are kept at once: opening a session releases the oldest beyond that. After either, `session.open` starts the session again.
- Consecutive deltas of one item merge into one `conversation.delta` of at most 64 KiB, so a fast stream sends few messages.
- The session host buffers at most 4 MiB per client and session. When a client falls further behind, the session host drops that client's terminal frames for the session and sends `session.resync_required`. The client then attaches again: the native conversation reloads its newest page, and the CLI conversation attaches after the last sequence it wrote.

## Messages from the client

| Message               | Purpose                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `hello`               | Opens the connection.                                                                                                     |
| `application.command` | Forwards a Lervo application command, such as `workspace.start`, to the resident Lervo process.                           |
| `session.open`        | Starts or returns the agent session of an existing workspace, optionally in a conversation mode.                          |
| `session.attach`      | Subscribes to a session from a sequence.                                                                                  |
| `session.detach`      | Ends the subscription. The session keeps running.                                                                         |
| `sessions.watch`      | Subscribes to the status of every session, without output.                                                                |
| `session.send`        | Sends the user's text to the native conversation; `session.sent` or `request.failed` answers it.                          |
| `session.interrupt`   | Stops the native conversation's running turn and keeps the session; `session.interrupted` or `request.failed` answers it. |
| `session.resize`      | Sets the CLI conversation's terminal size.                                                                                |
| `session.stop`        | Stops the agent session.                                                                                                  |
| `conversation.range`  | Requests older or newer conversation items, at most 200 per request.                                                      |

A session host from before `session.interrupt` closes the connection on it, so the interface sends it only to a session host at least as new as itself, and only while the core advertises `decoder.interrupt` ([core link](ade-core-link.md)).

The interface never names a path or a launch descriptor. `workspace.start` and `session.open` make the session host ask the Lervo core for a launch descriptor and run it, so the interface handles only opaque identifiers.

## Messages from the session host

| Message                   | Purpose                                                                        |
| ------------------------- | ------------------------------------------------------------------------------ |
| `welcome`, `rejected`     | Answer `hello`.                                                                |
| `application.result`      | Returns the result of an application command.                                  |
| `request.failed`          | Reports that a request failed, with a code and parameters.                     |
| `session.opened`          | Confirms a session, its conversation mode, and its terminal channel.           |
| `session.sent`            | Confirms that the text of a `session.send` reached the provider.               |
| `session.interrupted`     | Confirms that a `session.interrupt` reached the provider, or found no turn.    |
| `session.status`          | Reports `starting`, `working`, `needs_user`, `idle`, or `ended`.               |
| `conversation.appended`   | Appends live conversation items, or replaces an item with the same `itemId`.   |
| `conversation.delta`      | Appends streamed text to one conversation item.                                |
| `conversation.page`       | Answers `conversation.range`.                                                  |
| `session.resync_required` | Tells a client that fell behind to attach again.                               |
| `notice`                  | Reports a condition that is notice-only, such as `provider_login_unavailable`. |

## Conversation items

A conversation item has an opaque `itemId`, a `kind`, a creation time, and a `state` of `streaming` or `complete`. A streaming item becomes complete when `conversation.appended` repeats it with the state `complete`.

| Kind            | Content                                                                |
| --------------- | ---------------------------------------------------------------------- |
| `user_message`  | The user's text                                                        |
| `agent_message` | The agent's text, streamed through `conversation.delta`                |
| `tool_activity` | The tool name, a status, a count of calls, and an optional tool detail |
| `question`      | The agent's question to the user                                       |
| `lervo_notice`  | A Lervo code with parameters, such as `knowledge_lint_passed`          |

A Lervo notice carries a code, never a sentence, and the interface renders it from its message catalog. Conversation text from the user and the agent passes through unchanged.

### Tool detail

A tool call's `detail` says what the call acted on and what it showed, bounded so a page of tool lines stays well within one frame. The provider's transcript keeps the full input and output.

| Field     | Content                                                                                                                                                                                                                                                                                               |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `subject` | What the call acted on: a `path` relative to the workspace or `~/…`, a `command`, a `pattern`, a `query`, a `url`, or `text`; at most 512 characters                                                                                                                                                  |
| `counts`  | Optional `lines`, `matches`, `files`, `added`, and `removed`                                                                                                                                                                                                                                          |
| `lervo`   | The Lervo command a shell call ran: its `command` path, empty for `lervo --version` or `lervo --help`, an optional `help` or `version` `flag`, its first quoted positional argument as `subject`, and for a knowledge search the count it `found` and up to 10 `hits` with title, path, and freshness |
| `preview` | The `output` or `diff` lines the line opens to: at most 24 lines of 240 characters and 1,536 characters in all. `omittedLines` lines were left out before the line at index `omittedAt`                                                                                                               |

- An output keeps its first six lines and as many of its last as fit, where errors and summaries appear. A diff keeps its start.
- A failed call previews its error. A call whose input names nothing to show, such as a task list, has no detail.
- The adapter builds the detail; the session host drops one that is not valid or that exceeds 6 KiB, and the line still shows the call. A line stored before details existed shows the tool and its status.
- The core adds `lervo`, never a provider adapter. A shell call is Lervo's when its own work is one `lervo` command: it may change directory first, pipe the output into a filter, and follow with another Lervo call or a message. A line that also runs other commands stays a shell call. The command path is the longest one in the CLI's command catalog (ADR-0562). A newer command keeps its first word.
- A knowledge search's count and hits come from the lines `lervo knowledge query` prints, which the CLI formats and reads in one module. The adapter passes a shell call's output, at most 64 KiB, to the core within the resident process; the core link removes it before the session host receives the item. The hits stand in for the output's preview; a search that found nothing keeps its preview, which says why.
- `lervoCommandIds` in the contract lists every command path. The CLI's tests keep it equal to the catalog of its usage text, and the ADE's tests require a sentence for each, so every command reads as what Lervo did.
- The conversation index stores what the provider's transcript already holds, under the same owner-only state directory. Logs and Lervo events never hold tool inputs or outputs.

## Limits

- A control message is at most 1 MiB, and one `conversation.delta` appends at most 64 KiB of text.
- `conversation.range` returns at most 200 items.
- Identifiers are opaque strings of at most 64 characters.

## Privacy and failure

- Conversation text crosses only the owner-only local channel. Logs on either side record message kinds, identifiers, and sizes, never message bodies or terminal bytes.
- **The diagnostics log.** The session host writes `diagnostics.log` in its state directory, one JSON line per event.
  - Events: `host.started`, `accept.failed`, `connection.opened`, `connection.ended` with the code it ended with, `request.failed` with its code, and `session.started` with the session, its mode, and its channel.
  - Values: numbers, and strings that look like codes or identifiers. Anything else is written as `redacted`, so no message body, file path, or terminal byte can reach the log.
  - Bounds: the file rotates to `diagnostics.log.1` at 512 KiB, so the log holds at most 1 MiB.
  - Writing: a writer thread owns the file, and an entry that finds its queue full is dropped, so the log never delays the host.
- A message that fails schema validation closes the connection with `message_invalid` on the receiving side. The sender learns of it from the closed connection and reconnects.
- `request.failed` carries one of these codes:
  - `workspace_start_failed`, `provider_cli_unavailable`, and `provider_login_unavailable`, as the sessions specification defines them;
  - `session_not_found`: no session has that identifier, or its ended session is no longer retained;
  - `session_ended`: the provider process exited, so `session.send` cannot reach it;
  - `range_invalid`: the anchor is not in the conversation, or the limit is out of bounds;
  - `conversation_mode_unsupported`: the request does not apply to the session's conversation mode, such as `session.send` to the CLI conversation;
  - `conversation_index_corrupt`: the conversation index could not open, store, or read items. Live items keep flowing, and the index is rebuilt from the provider's transcript;
  - `workspace_not_found`: `session.open` named a workspace that the core has no launch record or worktree for;
  - `launch_intent_invalid`: the provider's adapter refused the launch, for example a resume it cannot perform;
  - `application_failed`: the resident Lervo process reported a failure that the session host has no name for;
  - `application_unavailable`: the resident Lervo process is not running or not reachable;
  - `application_timeout`: the resident Lervo process did not answer within the request's deadline;
  - `session_start_failed`: the provider's CLI exists, but its process could not start, for example because the system refused a PTY or a process. The `reason` parameter names the error kind;
  - `session_stop_timeout`: a conversation mode switch could not stop the running provider process in time. The session keeps running in its current mode.
  - `interrupt_unsupported`: the session cannot stop a turn and keep running. The CLI conversation stops a turn in its terminal, a provider's decoder may not offer it, and a resident process may not advertise `decoder.interrupt`. The turn goes on.
- A failure that the core reported carries the core's own code in the `coreCode` parameter and, for `workspace.start`, the failed stage in the `stage` parameter. The [core link](ade-core-link.md) defines how the session host reaches the core.
