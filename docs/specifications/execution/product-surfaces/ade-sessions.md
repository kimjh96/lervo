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

The provider adapter owns these options. The session host receives an opaque launch descriptor, which holds the executable, arguments, added environment names, and working directory. The session host never branches on the provider (invariant 2).

The ADE supports Claude Code and the Codex CLI first. The Codex adapter maps the same launch intent to Codex's own options and declares the capabilities it lacks instead of emulating them. Gemini, Grok, and later providers arrive as new adapters from the registry of admitted adapters ([ADR-0536](../../../decisions/execution/providers/admission/0536-admit-provider-clis-by-contract.md)), without changes to the UI, the session host, or other adapters.

A managed session is available when the user configures an API key. It follows ADR-0010 without change.

## Conversation modes

A hosted session reaches the user in one of two modes.

| Mode                | How the CLI runs                                                                                 | What the user sees                                         | What Lervo observes                               |
| ------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------- |
| Native conversation | Print mode with structured streams (`-p --input-format stream-json --output-format stream-json`) | The ADE renders messages, tool activity, and questions     | Every streamed message and tool event, plus hooks |
| CLI conversation    | The interactive CLI in a PTY                                                                     | The provider's own terminal interface inside the workspace | Hooks only                                        |

The native conversation is the target experience. The CLI conversation is the fallback that every installation can always use.

The native conversation runs the CLI the same way the Agent SDK does. Its use under a subscription login in a distributed product therefore needs Anthropic's confirmation. Until Anthropic confirms it, these defaults apply:

- An installation that uses a subscription login defaults to the CLI conversation.
- An installation that uses an API key defaults to the native conversation.
- The user can switch a workspace between the two modes at any time.

A managed session always renders as a native conversation.

## Hosted observations

Hosted sessions record their own observations. They are never E1–E4 and never satisfy a managed context or write gate (invariant 3). Hosting removes one of ADR-0197's four reasons, because Lervo starts the provider. The other three reasons still hold.

- `launched`: the provider's `SessionStart` hook reported a session ID that Lervo prepared, for a launch descriptor that Lervo recorded. Every other hosted observation requires it.
- `prepared` and `referenced`: unchanged from ADR-0197, bound to the launched session.
- `tool_observed`: a `PreToolUse`, `PostToolUse`, or `PostToolUseFailure` hook, or a streamed tool event in the native conversation, reported a tool call. A tool call that nothing reported is not proven absent. A Bash command can also change files that no hook names.
- `instructions_loaded`: an `InstructionsLoaded` hook reported a repository instruction file by path. This is provider-side loading. It is not Lervo's E2, and it proves neither injection nor use.

A session whose `SessionStart` never matches a prepared ID stays `launch_unconfirmed`. Its observations fall back to the ADR-0197 unmanaged ladder.

The native conversation's structured stream carries the same kinds of events that ADR-0010 reads. It still records hosted observations only. A native hosted session can claim an E3 receipt only after the provider adapter's common contract tests prove the same controlled-input coordinates that ADR-0010 requires.

## State, events, privacy, and failure meaning

- **`lervo workspace start`.** The command reads the instruction from stdin and takes `--repository` and `--host`. It creates the worktree and branch, starts the workstream, prepares the launch descriptor, and returns their identifiers as JSON. If a later stage fails, it removes what the earlier stages created and reports the failed stage.
- **`application.workspace.started`.** The required fields are `workspaceId`, `workstreamId`, `branch`, `sessionId`, `instructionDigest`, and `startedAt`. The instruction text stays in the provider conversation; the event holds only its digest.
- **Launch descriptor record.** Before each launch, Lervo writes `{schemaVersion: 1, sessionId, provider, workspaceId, conversationMode, argumentDigest, settingsDigest, mcpConfigDigest, preparedAt}` to owner-only host state. It holds no prompt text, environment values, or credentials, and its paths are repository-relative. Lervo retains the newest 256 records.
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
