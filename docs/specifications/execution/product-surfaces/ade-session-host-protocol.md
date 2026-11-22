# Lervo ADE session-host protocol

Status: `proposed`
As of: 2026-11-23

This specification defines version 1 of the protocol between the ADE interface (the client) and the session host. `@lervo/session-host-contract` holds its JSON Schema. The TypeScript types and the Rust types are generated from that schema, and both sides decode the same fixtures in contract tests. The [sessions specification](ade-sessions.md) defines the sessions, events, and failure meanings this protocol carries.

## Transport

- The transport is an ordered, reliable byte stream that only the owning OS user can open: a Unix domain socket on macOS, Linux, and WSL, and a named pipe on Windows. Between a Windows interface and a WSL session host, it is a loopback TCP connection.
- A later remote transport carries the same frames. Nothing in the protocol depends on the transport.
- The client is the Tauri shell. The webview cannot open the socket, so the shell relays messages to it over Tauri's IPC.

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

One session host runs per OS user. Its owner-only directory is `~/Library/Application Support/dev.lervo.ade` on macOS and `$XDG_STATE_HOME/lervo-ade` (or `~/.local/state/lervo-ade`) on Linux and WSL. It holds:

- `session-host.lock`, an exclusive lock held while the session host serves. A second instance finds it held and exits successfully, so the client can start the session host without first checking for one;
- `session-host.sock`, the socket, at mode 0600. A socket file left by a session host that no longer runs is replaced at start;
- `connection-token`, the token, at mode 0600;
- `conversations/`, one conversation index per native session.

The session host removes the socket and the token when it shuts down. Its sessions end with it.

## Sequencing and resumption

- Every session message that changes state carries a per-session `sequence`, a positive integer that only grows.
- One counter per session orders its status changes, conversation messages, and terminal frames.
- A client records the last sequence it applied. After a reconnection, `session.attach` with `afterSequence` makes the session host send what the client missed, then the current status:
  - for the CLI conversation, the scrollback after that sequence that it still holds;
  - for the native conversation, the item that is still streaming, if any. The client loads the items it missed with `conversation.range` after its last item. Clients keep items by `itemId`, so an item that arrives twice replaces itself.
- An ended session still answers `session.attach` and `conversation.range` for 10 minutes. After that, `session.open` starts the session again.
- The session host buffers at most 4 MiB per client and session. When a client falls further behind, the session host drops that client's terminal frames for the session and sends `session.resync_required`. The client then attaches again.

## Messages from the client

| Message               | Purpose                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| `hello`               | Opens the connection.                                                                           |
| `application.command` | Forwards a Lervo application command, such as `workspace.start`, to the resident Lervo process. |
| `session.open`        | Starts the agent session of an existing workspace.                                              |
| `session.attach`      | Subscribes to a session from a sequence.                                                        |
| `session.detach`      | Ends the subscription. The session keeps running.                                               |
| `session.send`        | Sends the user's text to the native conversation.                                               |
| `session.resize`      | Sets the CLI conversation's terminal size.                                                      |
| `session.stop`        | Stops the agent session.                                                                        |
| `conversation.range`  | Requests older or newer conversation items, at most 200 per request.                            |

The interface never names a path or a launch descriptor. `workspace.start` and `session.open` make the session host ask the Lervo core for a launch descriptor and run it, so the interface handles only opaque identifiers.

## Messages from the session host

| Message                   | Purpose                                                                        |
| ------------------------- | ------------------------------------------------------------------------------ |
| `welcome`, `rejected`     | Answer `hello`.                                                                |
| `application.result`      | Returns the result of an application command.                                  |
| `request.failed`          | Reports that a request failed, with a code and parameters.                     |
| `session.opened`          | Confirms a session, its conversation mode, and its terminal channel.           |
| `session.status`          | Reports `starting`, `working`, `needs_user`, `idle`, or `ended`.               |
| `conversation.appended`   | Appends live conversation items, or replaces an item with the same `itemId`.   |
| `conversation.delta`      | Appends streamed text to one conversation item.                                |
| `conversation.page`       | Answers `conversation.range`.                                                  |
| `session.resync_required` | Tells a client that fell behind to attach again.                               |
| `notice`                  | Reports a condition that is notice-only, such as `provider_login_unavailable`. |

## Conversation items

A conversation item has an opaque `itemId`, a `kind`, a creation time, and a `state` of `streaming` or `complete`. A streaming item becomes complete when `conversation.appended` repeats it with the state `complete`.

| Kind            | Content                                                                  |
| --------------- | ------------------------------------------------------------------------ |
| `user_message`  | The user's text                                                          |
| `agent_message` | The agent's text, streamed through `conversation.delta`                  |
| `tool_activity` | The tool name, a status, and a count of calls, without inputs or outputs |
| `question`      | The agent's question to the user                                         |
| `lervo_notice`  | A Lervo code with parameters, such as `knowledge_lint_passed`            |

A Lervo notice carries a code, never a sentence, and the interface renders it from its message catalog. Conversation text from the user and the agent passes through unchanged.

## Limits

- A control message is at most 1 MiB, and one `conversation.delta` appends at most 64 KiB of text.
- `conversation.range` returns at most 200 items.
- Identifiers are opaque strings of at most 64 characters.

## Privacy and failure

- Conversation text crosses only the owner-only local channel. Logs on either side record message kinds, identifiers, and sizes, never message bodies or terminal bytes.
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
  - `application_unavailable`: the resident Lervo process is not running or not reachable.
- A failure that the core reported carries the core's own code in the `coreCode` parameter and, for `workspace.start`, the failed stage in the `stage` parameter. The [core link](ade-core-link.md) defines how the session host reaches the core.
