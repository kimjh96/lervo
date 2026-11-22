---
lervo:
  decision:
    taxonomy: decisions.default
    route: execution.applications
---

# ADR-0613: Host provider CLIs in a first-party development environment

Status: `proposed`
Decision date: 2026-11-22
Amends: [ADR-0197](../providers/0197-unmanaged-terminal-context-observation.md) (adds hosted observations beside the unmanaged ladder), [ADR-0417](0417-own-discord-visible-reference-product.md) (the future first-party surface)
Related: [ADR-0010](../providers/0010-claude-agent-sdk-managed-adapter.md), [ADR-0196](../providers/0196-fail-closed-provider-terminal-integration.md), [ADR-0501](../grounding/0501-share-context-quality-contracts-across-product-surfaces.md), [ADR-0536](../providers/admission/0536-admit-provider-clis-by-contract.md), [ADR-0560](../../foundation/0560-remove-unused-subsystems-to-harden-the-core.md)

## Context

The owner uses Orca, a desktop workspace application, only to open Claude Code and Codex CLI windows. Lervo reaches Orca through `@lervo/workspace-host-orca`, which lists, creates, and removes worktrees and lists terminals. The owner wants an environment in which the user only gives instructions, and Lervo prepares the workspace, starts the agent, records the workstream, and checks the result.

Work in Orca's windows is direct provider work. ADR-0197 marks it `unmanaged` because Lervo does not start the provider, obtains no adapter delivery receipt, cannot gate every effect, and cannot observe model internals. The native-hook path prepares at most 8 KiB of context per prompt ([direct provider terminals](../../../architecture/system/managed-execution/direct-provider-terminals.md)). Lervo's managed Claude adapter (ADR-0010) observes sessions, turns, and tools and issues E3 receipts, but only background work uses it.

The owner intends to distribute the environment. The [Agent SDK documentation](https://code.claude.com/docs/en/agent-sdk/overview) states that, unless previously approved, Anthropic does not allow third-party developers to offer claude.ai login or rate limits for their products, including agents built on the Agent SDK. Most developers pay for agent work through a provider subscription, and only the provider's own CLI uses that subscription.

ADR-0560 removed the packed product-host protocol because nothing invoked it. `lervo application attention` is the only remaining application query.

## Decision

### An instruction-first desktop environment

Lervo ships a desktop application, the Lervo ADE (agentic development environment). It carries the Lervo name and logo. It runs on macOS, Linux, and Windows, and on Windows it works inside WSL distributions. It replaces Orca for the owner.

The application shows two concepts:

- **Workspaces.** A workspace is one workstream on its own worktree and branch. The workspace list groups workspaces by repository and names each one by its workstream title.
- **The conversation.** Each workspace has one conversation with the agent that works in it. The user steers the work there.

The user starts work by writing an instruction and choosing a repository and a host. Lervo then creates the worktree and branch, starts the workstream, and launches the agent session with the instruction as its first prompt. The user never creates a branch, a worktree, or a session by hand.

### The Lervo core does the work

The ADE is a surface and a process host over the Lervo core, not a second implementation of it. Workstreams, workspaces, context delivery, policy, verification, evidence, knowledge, and model selection stay in the existing core packages. The ADE adds the UI, the session host, and application commands that compose the core. A decision that the ADE needs and the core lacks goes into the owning core package with that package's tests.

The UI talks to one endpoint per host, the session host. The session host forwards application commands to the host's resident Lervo application process, so no action pays for a Node start. A one-shot `lervo` CLI call is the fallback when the resident process is unavailable.

### Provider CLIs own the agent loop

An agent loop is the cycle that calls the model, runs the tools the model chooses, returns their results, and repeats until the turn ends. It also decides compaction, permissions, and subagents. The ADE does not implement an agent loop. Agent turns run inside the provider's CLI or inside an ADR-0010 managed session.

- A subscription works only through the provider's CLI. An owned loop would make every user pay for API usage on top of their subscription.
- Provider harnesses change with each model release. An owned loop would trail them permanently.
- Tools, sandboxing, permissions, compaction, prompt caching, retries, MCP, and subagents are each a subsystem that needs maintenance. Lervo's value is the context, policy, and evidence layer around the loop (invariant 2).

Existing bounded structured calls, such as background classification, keep their current admission rules. This decision does not change them.

### Sessions and conversation modes

The ADE runs three session kinds: a shell, a hosted session, and a managed session.

- A hosted session runs the user's installed provider CLI under the user's own login. Lervo prepares its launch, and the session host executes it. It is the default agent session.
- A managed session is an ADR-0010 adapter session that the user enables with an API key.

A hosted session reaches the user in one of two conversation modes:

- The native conversation runs the CLI with structured streams, and the ADE renders it. It is the target experience.
- The CLI conversation shows the provider's own terminal interface. It is the fallback that every installation can always use.

The native conversation runs the CLI the same way the Agent SDK does, so its use under a subscription login in a distributed product needs Anthropic's confirmation. Until Anthropic confirms it, an installation with a subscription login defaults to the CLI conversation, and an installation with an API key defaults to the native conversation. The user can switch a workspace between the modes at any time.

Hosted sessions record hosted observations: `launched`, `tool_observed`, `instructions_loaded`, and ADR-0197's `prepared` and `referenced`. Hosting removes one of ADR-0197's four reasons for `unmanaged`, because Lervo starts the provider; the other three still hold. Hosted observations are never E1–E4 and never satisfy a managed context or write gate (invariant 3).

The ADE supports Claude Code and the Codex CLI first. Each provider's adapter owns its launch options and declares its capabilities. Gemini, Grok, and later providers arrive as new adapters from the registry of admitted adapters (ADR-0536), without changes to the UI, the session host, or other adapters.

[Lervo ADE sessions](../../../specifications/execution/product-surfaces/ade-sessions.md) defines the launch options, the conversation modes, and the hosted observations.

### The session host owns processes, and the UI only presents

Each host runs one session host per OS user. The session host is a headless process written in Rust.

- It owns PTYs, structured-stream processes, and provider processes.
- It keeps bounded presentation state: workspace layout, scrollback, and live status.
- It outlives the UI. Closing the window leaves sessions running, and reopening it reattaches them.

The UI is a Tauri 2 application with a React front end. It connects to the session host over a local channel that only the owning OS user can open. The session host runs where the repository lives; for a repository inside a WSL distribution, it runs inside that distribution.

The session host is not a Lervo authority. Lervo's hook handlers keep recording evidence through the `lervo` CLI. Live status (working, needs the user, finished) comes from `Notification` and `Stop` hook signals that the session-scoped hooks forward to the session host, or from the structured stream. It is presentation state, not evidence.

### The ADE owns no authority

The product-surface boundary applies. The ADE renders state, collects intent, and invokes Lervo commands. It keeps no task, chat, memory, approval, or completion store.

- The ADE reads Lervo through existing JSON commands, such as `lervo workstream current` and `lervo application attention`. It does not revive the removed product-host protocol. A slice that needs a new application command defines the command's name, fields, privacy handling, and failure meaning.
- The ADE adds no approval prompt of its own. Consequential effects follow invariant 10: Lervo cross-checks them, makes them reversible, and notifies afterward. When the agent asks the user a question, the question appears in the conversation as a question, not as an approval.
- The ADE behaves the same on every host. No feature is limited to one host.
- Local work needs no Hub (invariant 1).

### Workspaces come from the existing hosts

The ADE creates and lists worktrees through `@lervo/workspace-host-git`. `@lervo/workspace-host-orca` is removed once no host uses Orca.

### Visual language

The owner chose the visual language from mockups: restrained glass from the platform's native window material, light and dark modes, a screen with only the workspace list and the conversation, two status colors (blue for working, amber for needing the user), plain copy that states what Lervo verified, and a logo of three stepped bars whose last bar takes the brand blue. The [Lervo ADE visual language](../../../specifications/execution/product-surfaces/ade-visual-language.md) defines the tokens, the contrast evidence, the terminal palette, and the logo rules. Component primitives are defined before S1 code lands.

### Engineering foundations

The [Lervo ADE convention](../../../foundation/ade-convention.md) turns the owner's requirements into enforceable rules:

- **Structure.** Contract, domain, adapter, and composition layers; features with one public surface; registries instead of branching.
- **Performance.** Rules and budgets for CPU, memory, GPU, disk, energy, processes, and size, with unbounded conversations held and rendered in bounded windows.
- **Cloud readiness.** A versioned protocol over an abstract transport, location-free identities, and resumable sequences, with no cloud host built now.
- **Localization.** Message catalogs and codes across boundaries, with English shipped first.
- **Providers.** Capability-declaring adapters, so that the UI and the session host never branch on a provider ID.
- **Further quality.** Reliability, security, privacy, accessibility, compatibility, cross-host parity, observability, and testing.

## Slices

- **S1: instruction-first workspaces with the CLI conversation.** The start screen takes an instruction, a repository, and a host. `lervo workspace start` creates the worktree, branch, workstream, and launch descriptor. The session host owns PTYs, reattaches sessions, and keeps bounded scrollback. The workspace list shows live status and sends desktop notifications. Claude Code and Codex CLI sessions launch through their adapters. The UI reaches the core through the session host and the resident Lervo application process. The protocol, the `en` message catalog, the light and dark themes, and the logo ship. S1 covers macOS and Linux, including WSL.
- **S2: the native conversation and hosted evidence.** The ADE renders the structured stream from the segment index. Lervo records the hosted observations and their events, and `lervo terminal coverage` reports hosted sessions separately. The Lervo MCP server ships. Managed sessions open when the user configures an API key.
- **S3: distribution.** Installers are signed and update themselves. Onboarding checks the Lervo CLI, the provider CLI, and its login, and picks the default conversation mode. A provider registry replaces fixed provider values, so further provider CLIs can arrive through their adapters. `@lervo/workspace-host-orca` is removed.

An editor, Git views, diff review, and a browser preview start only when a concrete need appears.

### Performance budgets

The [performance rules](../../../foundation/ade-convention/performance.md) hold every budget, including S1's initial targets. S1 measures a baseline on the owner's Mac and WSL hosts and records it as evidence. A measurement that misses its target fails slice completion unless a reviewed revision of the target accompanies it.

## State, events, privacy, and failure meaning

[Lervo ADE sessions](../../../specifications/execution/product-surfaces/ade-sessions.md) defines each of the following with its required fields, privacy handling, and failure meaning:

- the `lervo workspace start` command and the launch descriptor record;
- the events `application.workspace.started`, `terminal.session.launch_prepared`, `terminal.session.launched`, `terminal.tool.observed`, `terminal.instructions.loaded`, and `terminal.session.ended`;
- the failure meanings `workspace_start_failed`, `session_host_unavailable`, `provider_cli_unavailable`, `provider_login_unavailable`, and `launch_preparation_failed`.

## Consequences

- The user gives instructions and answers questions; Lervo owns every preparation step.
- Hosted sessions keep the user's subscription and add launch, tool, and instruction observations to direct provider work. They still prove neither injection nor use.
- Lervo adds Rust and a React front end. The code convention, commit convention, quality gates, and CI need language profiles before S1 code lands.
- Desktop bundles for three platforms take long to build. They build at release, not on every pull request.
- The ADE keeps its own branding and does not present itself as a provider's product.
- Before public distribution, Anthropic must confirm whether the native conversation may run under a subscription login, and each provider must confirm that hosting its CLI under the user's own login is permitted.

## Open questions

- Anthropic's and OpenAI's answers on the native conversation under a subscription login.
- Component primitives.
- The language profiles for Rust and the front end.
- Whether the installer bundles the Lervo CLI or installs it through [ADR-0571](../../distribution/0571-install-the-verified-cli-on-each-host-and-roll-back-by-activation-id.md).
- Support for native Windows repositories outside WSL.

## Verification

- **S1.**
  - An instruction sent from the start screen creates a worktree, a branch, a workstream, and a hosted Claude Code session that starts with that instruction.
  - Each stage failure of `lervo workspace start` leaves no worktree, branch, or workstream behind.
  - Close the UI while a hosted session runs, then reopen it. The provider process keeps its process ID, the scrollback returns, and the session continues.
  - A hosted launch records `terminal.session.launch_prepared` and `terminal.session.launched` with the same `sessionId`. The user's Claude Code settings files keep their bytes.
  - A Codex CLI session starts the same way on a host with a Codex login. On a host without one, the ADE reports `provider_login_unavailable` and Claude Code sessions keep working.
  - Lint finds no string literal in JSX, and every interface string comes from the `en` catalog.
  - The same checks pass on the owner's Mac and in WSL.
  - The budget measurements are recorded, and each meets its target or carries a reviewed revision.
- **S2.** A native conversation renders the streamed messages and tool activity of a hosted session. A seeded conversation of 100,000 items meets the conversation budgets of the ADE convention. The session reports `tool_observed` and `instructions_loaded`. `lervo terminal coverage` lists it separately from unmanaged and managed sessions. No hosted observation appears as E3 or E4.
- **S3.** On a clean machine without Orca, the ADE installs, passes onboarding, picks the default conversation mode for its login, and opens a hosted session.
