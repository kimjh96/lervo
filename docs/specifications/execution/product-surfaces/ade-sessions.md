# Lervo ADE sessions

Status: `proposed`
As of: 2026-11-22

This specification defines the sessions of the Lervo ADE that [ADR-0613](../../../decisions/execution/applications/0613-host-provider-clis-in-a-first-party-development-environment.md) proposes: session kinds, launch options, conversation modes, hosted observations, and the commands, events, and failure meanings they use.

## Session kinds

| Kind    | Process                                              | Login                          | Evidence                    |
| ------- | ---------------------------------------------------- | ------------------------------ | --------------------------- |
| Shell   | A login shell in a PTY                               | None                           | None                        |
| Hosted  | The user's installed provider CLI, launched by Lervo | The user's own provider login  | Hosted observations (below) |
| Managed | An ADR-0010 adapter session                          | An API key the user configures | E0–E4, unchanged            |

A hosted session is the default agent session. Lervo prepares its launch, and the session host executes it. For Claude Code, the launch uses these documented [CLI options](https://code.claude.com/docs/en/cli-reference):

- `--session-id` with a Lervo UUID, so hook events bind to the session that Lervo started;
- `--settings` with a session-scoped file that adds Lervo's hook handlers, leaving the user's settings files unchanged (invariant 5);
- `--mcp-config` with Lervo's MCP server;
- `--append-system-prompt-file` with the role's instructions.

The provider adapter owns these options. The session host receives an opaque launch descriptor, which holds the executable, arguments, added environment, working directory, and initial input. The session host never branches on the provider (invariant 2).

Each adapter implements the hosted-session contract of `@lervo/adapter-contract`. It declares `nativeConversation`, `sessionIdBinding`, `hooks`, `mcp`, `systemPromptFile`, and `resume`, and every adapter's tests run the common hosted-session checks against its launches. A capability stays false until the launch actually provides it. In S1.4a, Claude Code declares the native conversation, session ID binding, and resume. Its native conversation uses `--permission-mode auto`, because print mode cannot ask the user for permissions; the CLI conversation keeps the user's own permission settings. The Codex CLI declares only the CLI conversation: Codex chooses its own session ID, and its native conversation waits until its decoder is proven against a real Codex session.

The ADE supports Claude Code and the Codex CLI first. The Codex adapter maps the same launch intent to Codex's own options and declares the capabilities it lacks instead of emulating them. Gemini, Grok, and later providers arrive as new adapters from the registry of admitted adapters ([ADR-0536](../../../decisions/execution/providers/admission/0536-admit-provider-clis-by-contract.md)), without changes to the UI, the session host, or other adapters.

A managed session is available when the user configures an API key. It follows ADR-0010 without change.

## Conversation modes

A hosted session reaches the user in one of two modes.

| Mode                | How the CLI runs                                                                                 | What the user sees                                         | What Lervo observes                               |
| ------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------- |
| Native conversation | Print mode with structured streams (`-p --input-format stream-json --output-format stream-json`) | The ADE renders messages, tool activity, and questions     | Every streamed message and tool event, plus hooks |
| CLI conversation    | The interactive CLI in a PTY                                                                     | The provider's own terminal interface inside the workspace | Hooks only                                        |

The native conversation is the target experience. The CLI conversation is the fallback that every installation can always use.

Both modes run the unmodified provider CLI under the user's own sign-in, so the native conversation is the default for every sign-in. The user can switch a workspace to the CLI conversation at any time.

A managed session always renders as a native conversation.

## Provider terms

The ADE runs each provider CLI under that provider's terms. For Claude Code, Anthropic's [legal and compliance terms](https://code.claude.com/docs/en/legal-and-compliance) allow a product to run the binary under each user's own sign-in, with these conditions:

- Lervo runs the Claude Code binary as Anthropic publishes it, and never removes or restricts its authentication methods.
- Each user signs in through Claude Code's own flow, with their own subscription or API key. Lervo never collects, stores, or forwards Claude credentials or session tokens.
- Lervo never pays for, resells, or intermediates Claude usage on a user's behalf.
- The ADE may state in plain text that it runs Claude Code. It never uses the Claude Code or Anthropic names or logos in its own name or logo.
- The publisher of a distributed build accepts Anthropic's Commercial Terms of Service.
- Managed sessions use the Agent SDK and therefore use API keys only.

The Codex CLI ships in a distributed build only after OpenAI's terms are checked against the same conditions. A provider adapter that cannot meet its provider's terms is not admitted (ADR-0536).

## Hosted observations

Hosted sessions record their own observations. They are never E1–E4 and never satisfy a managed context or write gate (invariant 3). Hosting removes one of ADR-0197's four reasons, because Lervo starts the provider. The other three reasons still hold.

- `launched`: the provider's `SessionStart` hook reported a session ID that Lervo prepared, for a launch descriptor that Lervo recorded. Every other hosted observation requires it.
- `prepared` and `referenced`: unchanged from ADR-0197, bound to the launched session.
- `tool_observed`: a `PreToolUse`, `PostToolUse`, or `PostToolUseFailure` hook, or a streamed tool event in the native conversation, reported a tool call. A tool call that nothing reported is not proven absent. A Bash command can also change files that no hook names.
- `instructions_loaded`: an `InstructionsLoaded` hook reported a repository instruction file by path. This is provider-side loading. It is not Lervo's E2, and it proves neither injection nor use.

A session whose `SessionStart` never matches a prepared ID stays `launch_unconfirmed`. Its observations fall back to the ADR-0197 unmanaged ladder.

Each adapter that declares `nativeConversation` provides a stream decoder, and the common hosted-session checks hold the two together. The decoder runs in the resident Lervo process behind the [core link](ade-core-link.md). Claude Code's decoder reads `stream-json` with partial messages. A text block becomes a streamed agent message. A tool call becomes one tool-activity item, succeeded or failed, when its result arrives. `result` ends the turn and adds the `provider_turn_failed` notice when the turn did not succeed. Subagent messages, thinking, hooks, and system lines stay out of the conversation, and tool inputs and outputs never leave the decoder. A tool that is still running shows only as the session's working status until its result arrives.

The native conversation's structured stream carries the same kinds of events that ADR-0010 reads. It still records hosted observations only. A native hosted session can claim an E3 receipt only after the provider adapter's common contract tests prove the same controlled-input coordinates that ADR-0010 requires.

## Conversation index

- The session host keeps one conversation index per session: segment files of 256 encoded items each, written as length-prefixed records.
- The index is a rebuildable projection of the provider's transcript (invariant 4). Appends skip `fsync`. When the index opens, it truncates a torn final record; a missing or damaged sealed segment reports `conversation_index_corrupt`, and the host rebuilds the index from the transcript.
- An item's identifier encodes its position, so the host finds any item without a lookup table that grows with the conversation.
- Sealed segments are cached in a byte-bounded cache. The open segment is read from its file.
- One item streams at a time and stays in memory until it completes; then the index stores it at the position it received when it started. Text beyond 256 KiB continues in a new item of the same kind, and one delta carries at most 64 KiB.
- An item that the provider adapter produced outside the protocol's limits is stored as the Lervo notice `conversation_item_invalid`, with no parameters, so every position stays filled.
- Each session keeps at most 1 MiB of sealed segments in memory.
- Retention: an index is removed with its workspace. All indexes on a host share a cap of 1 GiB. Each index directory holds an `opened` marker that the session host touches when the index opens; at that moment, the least recently opened indexes are removed until the rest fit. The index opening and the indexes of sessions the host still holds are never removed.

## State, events, privacy, and failure meaning

- **`lervo workspace start`.** The command reads the instruction from stdin. It takes `--repository` with a project ID from the host's repository registry, and optionally `--provider` (default `claude`), `--mode` (`native`, the default, or `cli`), and `--model`. It runs on the host where the repository lives; the session host there invokes it.
  - Before any change, it resolves the provider's hosted-session adapter and the provider CLI on `PATH`, and the adapter checks the launch intent. A refused intent changes nothing.
  - The **workspace** stage creates the branch `lervo/<words>-<6 hex>` from the default branch's tip. The words come from the ASCII words of the title, or `work` when there are none. The stage puts the worktree at `<repository>-wt/<branch leaf>` beside the repository and records the Git host's ownership marker in the worktree's Git directory. The workspace ID is `wsp_` followed by 24 hex characters.
  - The **workstream** stage starts the workstream in the new worktree, as `lervo workstream start --apply-now` would. The title is the instruction's first line, shortened to 80 characters at a word. The objective is the instruction, within the workstream's 8,192-character limit.
  - The **launch** stage prepares the hosted launch and writes its launch descriptor record.
  - The JSON result holds `workspaceId`, `workstreamId`, `projectId`, `branch`, `sessionId`, `provider`, and `launch`. The `launch` field holds the absolute program path, the arguments, the added environment, the working directory, the conversation mode, and `initialInput`, which is the text the session host sends through the stream decoder.
  - If a stage fails, the command removes the worktree and deletes the branch, which it deletes only while the branch still points at its base commit. It then reports the failed stage. The workstream's state lives in the worktree, so removing the worktree removes it; the events already recorded stay as history.
- **`lervo workspace open`.** It takes `--workspace` and optionally `--mode`, and prepares the launch that continues the workspace's hosted session. It resumes the recorded session where the adapter declares `resume`, and otherwise starts a new session in the same worktree. It finds the worktree from the record's project and branch, and records the new launch.
- **`application.workspace.started`.** The required fields are `workspaceId`, `workstreamId`, `branch`, `sessionId`, `instructionDigest`, and `startedAt`. The instruction text stays in the provider conversation; the event holds only its digest.
- **Launch descriptor record.** Before each launch, Lervo writes `{schemaVersion: 1, workspaceId, sessionId, provider, projectId, branch, conversationMode, argumentDigest, settingsDigest, mcpConfigDigest, preparedAt}` to `hosted-launches.json` in the user state directory, beside the repository registry, with mode 0600. It holds no instruction text, environment values, credentials, or paths. The branch name derives from the title's ASCII words, which Git already shows. `argumentDigest` covers the program and arguments, because the arguments of a CLI conversation carry the first instruction. Lervo retains the newest 256 records.
- **`terminal.session.launch_prepared`.** The required fields are `sessionId`, `provider`, `workspaceId`, `conversationMode`, `descriptorDigest`, and `policyHash`. Lervo records the event before it returns the descriptor. If preparation fails, the ADE opens the CLI without Lervo's options, labels the session `unmanaged`, and records attention. The user keeps working.
- **`terminal.session.launched`.** Lervo records it when `SessionStart` reports a prepared `sessionId`. The required fields are `sessionId`, `provider`, and `descriptorDigest`. A missing event means `launch_unconfirmed`.
- **`terminal.tool.observed`.** The required fields are `sessionId`, a digest of the tool use ID, the tool name, the phase (`pre`, `post`, or `failed`), the source (`hook` or `stream`), and the outcome. As in ADR-0010, the event excludes tool input, command text, output, and absolute paths.
- **`terminal.instructions.loaded`.** The required fields are `sessionId` and the repository-relative path. The content hash is present when Lervo can read the same bytes.
- **`terminal.session.ended`.** Lervo records it from `SessionEnd`, or from the session host when the process exits without that hook. The required fields are `sessionId` and `endReason`; `exitCode` is present when known.
- **Failure meanings.**
  - `workspace_start_failed`: a stage of `lervo workspace start` failed. The `stage` field is `workspace`, `workstream`, or `launch`. Nothing from the earlier stages remains, and the ADE shows the instruction again so that the user can retry.
  - `session_host_unavailable`: the UI cannot reach the session host and restarts it. Sessions end only when the session host itself exits.
  - `provider_cli_unavailable`: the provider CLI is missing or not admitted under ADR-0536. This is notice-only, and shell sessions keep working.
  - `provider_login_unavailable`: the CLI reports no login. This is notice-only.
  - `launch_preparation_failed`: the fallback described under `terminal.session.launch_prepared` applies.
  - `provider_unknown`: no admitted hosted-session adapter has that provider name. The result lists the admitted ones.
  - `conversation_mode_unsupported`: the provider does not declare `nativeConversation`, so only the CLI conversation can start. Nothing changed.
  - `resume_unsupported` and `launch_intent_invalid`: the adapter refused the launch intent before any change.
  - `workspace_not_found`: `lervo workspace open` found no launch record for the workspace, or its worktree no longer exists.
