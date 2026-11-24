# Lervo ADE core link

Status: `proposed`
As of: 2026-11-23

This specification defines the core link: the protocol between the ADE session host and the resident Lervo application process. [ADR-0613](../../../decisions/execution/applications/0613-host-provider-clis-in-a-first-party-development-environment.md) requires that resident process, so that no action pays for a Node start. `@lervo/session-host-contract` holds the link's JSON Schema beside the [session-host protocol](ade-session-host-protocol.md), and both sides validate against the same document.

## Transport

- The session host runs `lervo application serve --stdio` as its child on the first request. It starts the process again on the first request after the process exits.
- Requests travel on the child's standard input and responses on its standard output, one JSON message per line. Nothing else writes to the child's standard output. Its standard error is discarded.
- The link needs no socket or token: only the session host holds the child's pipes, and the child ends with the session host or when its input closes.
- The `--lervo` option of `lervo-session-host serve` names the `lervo` executable. Without it, the session host looks for `lervo` on its `PATH`.

## Contract and validation

- The schemas live in `packages/session-host-contract/src/core-link.ts`. The build writes them to `packages/session-host-contract/generated/core-link-protocol.schema.json`, and a contract test fails when the committed document is stale.
- The resident process validates every request with AJV. The session host validates every response with `jsonschema` and generates its types from the same document with `typify`.
- `packages/session-host-contract/test/fixtures/core-link/` holds valid requests, valid responses, and invalid messages that both sides must treat alike.
- `packages/session-host-contract/src/application-results.ts` holds each application command's result schema, which the same document carries. Results accept properties they do not name, so a newer core can add one without breaking an older session host. The `results` and `invalid-results` fixtures cover them.

## Requests and responses

Every request carries a positive integer `id`, and the resident process answers each request exactly once with that `id`.

| Request           | Purpose                                                                    | Answer                                                               |
| ----------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `core.command`    | Runs an application command, such as `workspace.start` or `provider.list`. | `core.result`, with `launch` for `workspace.start`, or `core.failed` |
| `core.open`       | Prepares the launch that continues a workspace, as `lervo workspace open`. | `core.result` with `launch`, or `core.failed`                        |
| `decoder.open`    | Creates a stream decoder for a provider under a session-host `decoderId`.  | `decoder.decoded` with no events, or `core.failed`                   |
| `decoder.send`    | Encodes the user's text for the provider's standard input.                 | `decoder.decoded` with `input` (Base64) and the events to show       |
| `decoder.output`  | Decodes a chunk of the provider's standard output, as Base64.              | `decoder.decoded` with the events                                    |
| `decoder.close`   | Forgets the decoder.                                                       | `decoder.decoded` with no events                                     |
| `transcript.read` | Reads a page of the provider's own transcript of a workspace's session.    | `transcript.page` with items and `complete`, or `core.failed`        |
| `session.exited`  | Reports that a hosted session's process ended, with its exit code.         | `core.result` with `status`, or `core.failed`                        |

- `workspace.list` answers `{workspaces, commands}`. `workspaces` are the host's workspaces with a hosted launch whose worktree still exists, newest first and at most 100. Each holds:
  - `workspaceId`, `projectId`, `repositoryName`, `branch`, and `title` (the workstream title, or null);
  - `provider` and `conversationMode`, the last mode;
  - `conversationModes`, the modes its provider offers, or only the last mode when no adapter admits the provider;
  - `sessionId` and `preparedAt`.

  It reads one worktree listing per repository. `commands` names every application command the resident process answers, and the core-link requests it advertises, such as `session.exited`.

- `workspace.start`, `workspace.list`, and `repository.list` are the base commands, which every release answers. The session host sends any other command only to a resident process whose last `workspace.list` named it, because a process from an older release ends the core link on a request it cannot validate.
- `provider.list` answers `{providers, defaultProvider}`, every admitted hosted provider in registry order. Each holds:
  - `provider`, its identifier;
  - `displayName`, its product name, such as "Claude Code", which interfaces show untranslated;
  - `capabilities`, as the adapter contract declares them;
  - `conversationModes`, the native conversation first when the provider offers it;
  - `preferredMode`;
  - `installed`, whether its CLI is on the resident process's `PATH`.

  `defaultProvider` is the provider a workspace starts with when `workspace.start` names none.

- `repository.list` answers `{repositories}`, each with `projectId` and `name`, sorted by name. It names no paths.
- `workspace.retire` takes `workspaceId` and answers `{workspaceId, worktree, branch}`. It removes the workspace as `lervo workspace retire` does ([Lervo ADE sessions](ade-sessions.md)). An invalid `workspaceId` fails that request alone with `workspace_not_found`.
- `workspace.start` takes `instruction` and `repository` (a project ID from the host's registry), and optionally `provider`, `mode`, and `model`. The result is the JSON of `lervo workspace start` without its `launch` field, which the response carries separately.
- A launch holds the session and workspace identifiers, the conversation mode, the provider, the absolute program path, the arguments, the added environment, the working directory, and `initialInput`. The session host sends `initialInput` through the decoder once the provider runs.
- A launch may also hold `environmentRemove`, the names of variables the session host must not pass on from its own environment. The provider's adapter lists them, such as the markers an enclosing Claude Code session sets for its children, which would otherwise turn off the hosted session's transcript and expose the enclosing session's messaging channel.
- A launch from `core.open` holds `transcript: true` when the provider's adapter can read its own transcript of the session. Only then does the session host send `transcript.read`, so a resident process from an older release never receives a request it does not know.
- `session.exited` takes the launch's `sessionId` and `exitCode`, an integer from 0 to 255 or null after a signal. The session host sends it only to a resident process whose last `workspace.list` named `session.exited`. The resident process finds the session's newest launch record. Unless an end of that launch is already recorded, it records `terminal.session.ended` with `endReason: process_exited`. An end is already recorded when the provider's `SessionEnd` hook recorded one at or after the launch's `preparedAt`. `status` is one of these:
  - `recorded`;
  - `skipped`, when the hook already recorded the end;
  - `inactive`, below event schema 10;
  - `unknown_session`, for a session that no launch record names.
- `transcript.read` takes `workspaceId`, `offset` (items to skip), and `limit` (at most 500). `transcript.page` answers with complete items, oldest first, as `item` events carry them, and `complete` when the transcript ended. A page holds at most 4 MiB of text. A request that continues the previous page resumes the same reader, so a transcript read page by page is read once. A provider that kept no transcript answers an empty, complete page.
- Decoded events are, in order of application: `status` (`turn_started`, `question_asked`, or `turn_finished`), `item` and `start` with conversation content and a creation time, `delta` with text for the streaming item, and `finish`. Content is a user message, an agent message, a question, tool activity (name, status, and call count), or a Lervo notice (a code and parameters).

## Concurrency and bounds

- Commands run concurrently. Decoder requests are answered at once and in arrival order, so a decoder's state follows its provider's stream exactly while a command waits on Git.
- A request line holds at most 2 MiB; a longer line ends the link. A `decoder.output` request carries at most 1 MiB of output, and the session host splits larger reads.
- At most 256 decoders are open at once; `decoder.open` beyond that fails with `decoder_limit_reached`.
- The session host waits 120 seconds for a command and 30 seconds for a decoder request.

## Failure meaning

- `core.failed` carries the core's code and, for `workspace.start`, the failed `stage`. The session host maps the code to a `request.failed` code of the session-host protocol and passes the core's code and stage as the `coreCode` and `stage` parameters. A code it has no name for becomes `application_failed`.
- A process that cannot start, exits, times out, or sends a message that fails validation fails every waiting request with `application_unavailable`. The next request starts the process again.
- A decoder that the restarted process no longer knows fails with `decoder_not_found`. The session host opens it again and retries once, so a restart loses at most a partial line of the provider's output.
- When decoding fails, the session host shows the Lervo notice `core_link_unavailable` or `core_decoding_failed` in the conversation instead of the lost events. The provider process keeps running.
- A malformed request makes the resident process print `core_link_message_invalid` on standard error and exit with status 1.
- The session host refuses a command the contract does not define, or one the running process did not advertise, with `application_unavailable` and the parameter `reason: command_unsupported`. It never sends it, so the process keeps running. A process started after the one that advertised the command has advertised nothing until its first `workspace.list`.
- A command result that does not match its schema fails with `application_failed` and `reason: result_invalid`, and the interface never receives it.

## Privacy

- Conversation text crosses only the pipes between the session host and its child. Neither side logs message bodies.
- Decoders never put tool inputs or tool outputs into events; tool activity carries the tool's name, status, and call count only.
