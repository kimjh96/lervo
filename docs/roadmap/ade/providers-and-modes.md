# Lervo ADE providers and modes from registries

Status: `planned`
As of: 2026-11-23

## Purpose

This plan resolves group 5 of the convention check (`docs/roadmap/ade.md`, "Convention check after S1.5e"). Some parts of the ADE name providers and conversation modes directly:

- the start screen lists `claude` and `codex` by name and defaults to `claude`;
- the workspace header offers both modes even when a provider has no native conversation;
- the frame and the session host branch on the mode.

The ADE convention says that capabilities decide what the interface offers, and that providers come from a registry rather than an enum ("Providers"). A third provider must arrive without changes to the interface or the session host.

## Design

### The core owns the registry

- **`displayName`.** Each hosted-session adapter states the provider's product name, such as "Claude Code". Product names are proper nouns: the interface shows them as given and translates nothing.
- **`provider.list`.** This new application command answers with every admitted hosted provider. Each entry gives:
  - its identifier and display name;
  - its capabilities;
  - the conversation modes it offers: the native conversation only with `nativeConversation`, and the CLI conversation always;
  - its preferred mode;
  - whether its CLI is installed on the host.
- **`workspace.list`.** Each workspace gains its provider's `conversationModes`.
- **Advertised commands.** `workspace.list` also gains `commands`, the application commands this core answers. The section on compatibility explains why.

### The contract types every result

- **Schemas.** `@lervo/session-host-contract` gains schemas for the results of `workspace.list`, `repository.list`, `workspace.start`, and `provider.list`, with their TypeScript and Rust types.
- **Validation at the boundary.** The session host validates each known command's result before it forwards `application.result`. Results accept properties they do not name, so a newer core can add one. A result that fails becomes `request.failed` with `application_failed` and the parameter `reason: result_invalid`. The interface then reads typed results without casts.

### Compatibility with an older core

A resident process from an older release rejects an unknown `core.command` by ending the core link. Two layers keep a newer command from reaching it:

- **The session host.** It records the `commands` of the last `workspace.list` result. It forwards a command outside the base three only when that list names it, and answers `request.failed` with `application_unavailable` and `reason: command_unsupported` otherwise. A restart of the resident process clears the record.
- **The interface.** It sends `provider.list` only after a `workspace.list` that names it. Without that, the start screen offers no provider choice, the core uses its default provider, and a notice says the installed Lervo is older than the app.

A workspace from an older core has no `conversationModes`, so the header offers both modes, as before.

### The interface reads registries

- **A `providers` feature** loads `provider.list` on each connection.
- **The start screen**:
  - offers installed providers by display name, and shows a missing CLI as unavailable;
  - remembers the last provider started;
  - takes the explanation's provider name from the registry, replacing the `start.provider.*` messages.
- **The workspace header** offers only the workspace's `conversationModes`, and hides the switch when there is one.
- **The frame** keeps its table from mode to view, so no other code branches on a mode.

### The session host reads registries

- **One dispatch point.** Each conversation mode has one starter: the native starter opens the index and the stream process, and the CLI starter opens the PTY. The lifecycle picks the starter for the launch's mode in one exhaustive `match`, and nothing else in the session host branches on a mode.
- **Modes are a closed set.** On 2026-11-23 the review for step 2 found that the protocol defines the modes, and a new provider adds none, because each provider offers some of the same two. A registry for two fixed entries would add indirection without extension, so the exhaustive `match` stays: the compiler reports every place a new protocol mode would need. Providers stay open, and the core's registry holds them.
- **One translation per protocol.** The session-host protocol's mode and the domain's mode convert in `messages.rs`, and the core link's mode converts in `core-link/src/events.rs`.

## Order

1. **Core and contract.** `displayName`, `provider.list`, `conversationModes` and `commands` in `workspace.list`, and the result schemas. This lands with a minor release intent, so it ships before the interface depends on it.
2. **Session host.** The command guard and result validation.
3. **Interface.** The `providers` feature, the start screen, and the header.

## Completion

The group is complete when:

- no interface or session-host code names a provider;
- the interface offers only the modes and providers the core reports;
- a stand-in third provider, added to a test registry with only the CLI conversation, appears on the start screen and in a workspace header without code changes;
- an older core keeps the app working without a provider choice;
- the contract tests cover every result schema.
