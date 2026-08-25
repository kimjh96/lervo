# ADR-0216: Managed provider terminal-hook isolation

Status: `accepted`
Decision date: 2026-08-25

## Context

Lervo installs provider-native `UserPromptSubmit` and `Stop` hooks for direct Codex and Claude terminals. These hooks create only unmanaged preparation and finalization observations. Managed runs already use a provider-neutral adapter, controlled context delivery, write gates, and verification.

A managed Codex deliberation started an app-server thread in the repository without disabling project hooks. The nested `UserPromptSubmit` hook treated the managed proposal as a direct terminal request, injected unmanaged instructions, and required another deliberation and terminal declaration at `Stop`. The provider repeatedly attempted to satisfy this recursive contract until the 600-second managed-turn deadline. A longer deadline would preserve the recursion and overstate the execution boundary.

Claude's SDK adapter already excludes project settings with `settingSources: []`, but the shared contract did not explain why this isolation is required.

## Decision

- Managed provider sessions must not execute provider-native project terminal hooks.
- On every `thread/start`, the Codex adapter supplies the thread-scoped override `features.hooks=false`, merged with exact managed MCP configuration when present. It does not edit repository, user, or organization configuration.
- The Claude adapter retains empty setting sources and may install only Lervo's in-process managed write hooks. These belong to the adapter contract, not provider-native terminal integration.
- Direct terminals continue using the reviewed project hooks from ADR-0196. Disabling hooks in a managed session changes neither installed configuration nor terminal activation evidence.
- Common adapter contracts and provider-specific tests must prove controlled injection and completion while isolation is active.
- A managed acceptance run in a repository with installed terminal hooks must complete without `terminal.context.prepared` or `terminal.turn.observed` events attributable to its provider turn.

This decision adds no event or state. Managed and unmanaged event contracts remain separate. If a managed provider cannot suppress project hooks, adapter startup fails before the task turn instead of invoking the repository through both boundaries.

## Failure meaning

| Failure | Meaning |
| --- | --- |
| Managed thread rejects the hook-disable override | `provider_protocol_failed`; no task turn or delivery completion is claimed. |
| Project terminal observation appears during a managed turn | Provider isolation is defective; the managed run is invalid and must not be accepted as deliberation or execution evidence. |
| Direct terminal hooks are disabled by user or organization policy | Existing terminal readiness behavior applies; managed execution remains available through its adapter. |

## Consequences

Managed deliberations and ordinary managed runs cannot recursively invoke Lervo's direct-terminal lifecycle. Codex and Claude retain provider-specific isolation behind their adapters; provider-neutral evidence and execution contracts remain unchanged.

## References

- [Codex app-server managed adapter](../0009-codex-app-server-managed-adapter.md)
- [Claude Agent SDK managed adapter](../0010-claude-agent-sdk-managed-adapter.md)
- [Fail-closed provider terminal integration](../0196-fail-closed-provider-terminal-integration.md)
- [Managed provider run lifecycle](../0011-managed-provider-run-lifecycle.md)
