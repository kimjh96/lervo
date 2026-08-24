# ADR-0196: Fail-Closed Provider Terminal Integration

- Status: accepted
- Decision date: 2026-08-24

## Context

Developers often start Codex or Claude Code directly. AGENTS and CLAUDE discovery can provide instructions, but file presence does not prove repository knowledge was queried. Calling these sessions managed would fabricate adapter, capability, write-gate, and verification evidence Lervo does not possess. Earlier migration only inventoried provider configuration; it established neither an enforced terminal entrypoint nor coexistence rules for existing hooks.

## Decision

Add a provider-neutral terminal-hook contract with Codex and Claude profiles. `lervo migrate knowledge` reaches this stage only after repository layout, structural publication, and the CLAUDE-to-AGENTS bridge are current.

One read-only plan covers `.codex/hooks.json` and `.claude/settings.json`. Changing either user-owned file requires one exact operation ID and approval hash. Migration:

- Parses JSON with comments and trailing commas.
- Preserves top-level settings and non-Lervo hooks.
- Appends one Lervo handler to `UserPromptSubmit` and `Stop`.
- Treats a current handler as idempotent and updates an older Lervo handler in place.
- Blocks the entire plan for malformed JSON, invalid hook shapes, another command claiming the Lervo terminal-hook namespace, Claude `disableAllHooks: true`, or Codex `[features] hooks = false`.
- Never silently enables hooks, edits local or global settings, translates provider hooks, or moves provider semantics into shared policy.

The versioned command is `lervo terminal hook --provider <provider> --contract 1` and must resolve in the provider process environment. Failure to find the repository, parse bounded input, query knowledge, validate exact publication bytes, inspect lifecycle state, or write a receipt exits with the provider's blocking failure code. Prompts and configuration are not echoed.

### `UserPromptSubmit`

The hook finds the nearest initialized repository from the provider working directory; queries local deterministic repository knowledge for the exact prompt; reloads bounded matching publications without following symlinks; verifies query-time hashes; and returns at most 28 KiB of valid UTF-8 context. The limit includes the preamble and metadata. Context contains paths, freshness, assurance, hashes, exact publication bytes, and one standalone Markdown HTML-comment evidence marker per document.

No-hit context still directs the agent to AGENTS and the knowledge entrypoint. Success proves a query attempt and provider-native context return, not attention, understanding, agreement, reference, or use.

### `Stop`

The hook checks terminal integration, repository layout, the Claude bridge, structural knowledge plan, lint, and document-normalization lifecycle. A non-current state returns a blocking reason and exact next command. It never auto-approves user bytes or semantic rewrites; the agent must complete safe generated work and surface approval genuinely requiring the user.

### Assurance boundary

Direct sessions remain `unmanaged`: Lervo did not create the process, establish its managed capability envelope, gate every write, or run managed verification. Provider-native delivery is narrower terminal observation, not managed E3.

Provider or organization controls may disable project hooks, and Codex requires exact non-managed command-hook review. Configuration proves installation only; invocation proves only that the Lervo endpoint ran for that event. Lervo never edits provider-local or global hook-trust state. Immediately after apply, human and JSON output must say that Codex skips untrusted project hooks and direct the user to open `/hooks` once to review the exact Lervo `UserPromptSubmit` and `Stop` commands. Vetted automation may use Codex's explicit one-time trust bypass, but migration permission is not provider trust.

### Activation receipts

Each successful invocation atomically replaces one provider-and-event receipt under ignored `.lervo/state/terminal-integration/`, limiting the directory to four files. Version 1 records provider, event, result, and time. Prompt receipts also record query digest, source snapshot, recommendation and loaded counts, and returned-context hash. Receipts contain no prompt, document body, absolute path, credentials, or provider output.

A receipt proves hook execution and context preparation, not provider acceptance or model use. [ADR-0197](0197-unmanaged-terminal-context-observation.md) adds canonical unmanaged observations and historical projection without upgrading them to managed evidence. Receipt failure makes the hook fail closed.

`lervo terminal status` validates each receipt against its canonical event and reports every provider and hook as `observed`, `partial`, or `not_observed`. It also reports `activationReadiness` as `action_required` with provider-specific instructions until all four event endpoints have canonical observations, exits nonzero while that action remains, and never equates a manually invoked endpoint with provider acceptance or internal use. Lifecycle currency remains separate: configuration may be current while activation is unobserved.

### Apply event and rollback

Successful apply emits `terminal.integration.applied`. Its allowlisted payload contains operation and plan IDs, contract ID, provider names, target path digests, target after-hashes, approval hash, and apply time. It excludes prompts, document bodies, raw settings, hook commands, credentials, absolute paths, and provider output. Apply failure rolls configuration back before the event and emits no success event.

## Consequences

Codex and Claude terminal users can make ordinary repository requests without manually running `lervo knowledge query`. Existing settings and hooks continue operating. Lervo fails closed when context cannot be supplied and blocks normal stop while tracked knowledge work is stale.

This narrows the unobserved surface but does not replace managed execution. Work requiring managed write authorization, provider receipts, verification, or full context coverage must use `lervo run`.

## References

- [Codex hooks](https://learn.chatgpt.com/docs/hooks)
- [Codex AGENTS.md guidance](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [Claude Code hooks](https://code.claude.com/docs/en/hooks)
- [Claude Code settings](https://code.claude.com/docs/en/configuration)
- [Managed provider lifecycle](0011-managed-provider-run-lifecycle.md)
- [Unmanaged terminal context observation](0197-unmanaged-terminal-context-observation.md)
- [Semantic repository migration](../../knowledge/repository/0193-semantic-repository-and-agent-surface-migration.md)
