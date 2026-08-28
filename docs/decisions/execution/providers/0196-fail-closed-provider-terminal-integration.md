# ADR-0196: Fail-Closed Provider Terminal Integration

- Status: accepted
- Decision date: 2026-08-24

## Context

Direct Codex and Claude Code sessions may discover AGENTS or CLAUDE instructions, but file presence does not prove a knowledge query. Treating these sessions as managed would fabricate adapter, capability, write-gate, and verification evidence. Earlier migration inventoried provider configuration without enforcing an entrypoint or coexistence rules.

## Decision

Add a provider-neutral terminal-hook contract with Codex and Claude profiles. `lervo migrate knowledge` reaches it only after the repository layout, structural publication, and CLAUDE-to-AGENTS bridge are current.

A single read-only plan covers `.codex/hooks.json` and `.claude/settings.json`. Every user-owned change requires an exact operation ID and approval hash. Migration:

- parses comments and trailing commas;
- preserves top-level settings and non-Lervo hooks;
- appends one Lervo handler to `UserPromptSubmit` and `Stop`;
- treats current handlers idempotently and updates older handlers in place; and
- blocks the entire plan for malformed JSON, invalid hook shapes, namespace conflicts, Claude `disableAllHooks: true`, or Codex `[features] hooks = false`.

It never silently enables hooks, edits local or global settings, translates provider hooks, or moves provider semantics into shared policy.

The original command was `lervo terminal hook --provider <provider> --contract 1`. [ADR-0204](0204-self-contained-repository-terminal-hook-runtime.md) replaces its PATH dependency with repository-local contract v2; v1 parsing remains only for in-flight legacy calls. Failure to find the repository, parse bounded input, query knowledge, validate exact publication bytes, inspect lifecycle state, or write a receipt exits with the provider blocking code. [ADR-0239](../grounding/0239-unmanaged-terminal-grounding-failure-abstention.md) provides the only narrower behavior: provider semantic-proposal failure during unmanaged prompt preparation records an empty typed abstention and returns fallback context, while managed consumers still reject the adapter failure. Prompts and configuration are never echoed.

### `UserPromptSubmit`

The hook finds the nearest initialized repository from the provider working directory, queries deterministic local knowledge using the exact prompt, reloads bounded matching publications without following symlinks, verifies query-time hashes, and returns at most 28 KiB of valid UTF-8 context containing the preamble and metadata. Context includes paths, freshness, assurance, hashes, exact publication bytes, and one standalone Markdown HTML-comment evidence marker per document.

No-hit context still directs the agent to AGENTS and the knowledge entrypoint. Success proves a query attempt and provider-native context return; it does not prove attention, understanding, agreement, reference, or use.

### `Stop`

The hook checks terminal integration, repository layout, the Claude bridge, structural knowledge plan, lint, and normalization lifecycle. Non-current state returns a blocking reason and the exact next command. It never auto-approves user bytes or semantic rewrites; the agent completes safe generated work and surfaces approvals that genuinely require the user.

### Assurance boundary

Direct sessions remain `unmanaged`: Lervo did not create the process, establish its managed capability envelope, gate every write, or perform managed verification. Provider-native delivery is terminal observation, not managed E3.

Provider or organization controls may disable project hooks, and Codex requires exact non-managed command-hook review. Configuration proves only installation; invocation proves only that the endpoint ran. Lervo never edits local or global provider hook-trust state. After apply, human and JSON output must state that Codex skips untrusted project hooks and instruct the user to open `/hooks` once to review the exact Lervo `UserPromptSubmit` and `Stop` commands. Vetted automation may use Codex's explicit one-time trust bypass; migration permission is not provider trust.

### Activation receipts

Every successful invocation atomically replaces one provider-and-event receipt under ignored `.lervo/state/terminal-integration/`, capped at four files. Version 1 stores provider, event, result, and time. Prompt receipts also store query digest, source snapshot, recommendation and loaded counts, and returned-context hash. Receipts exclude prompts, document bodies, absolute paths, credentials, and provider output.

A receipt proves hook execution and context preparation, not provider acceptance or model use. [ADR-0197](0197-unmanaged-terminal-context-observation.md) adds canonical unmanaged observations and history without upgrading them to managed evidence. Receipt failure fails closed.

`lervo terminal status` validates receipts against canonical events, reports each provider and hook as `observed`, `partial`, or `not_observed`, and reports `activationReadiness` as `action_required` until all four endpoints have canonical observations, with provider instructions while action remains. It exits nonzero while action remains, never treats manual invocation as provider acceptance or internal use, and keeps lifecycle currency separate from activation.

### Apply event and rollback

A successful apply emits `terminal.integration.applied` with operation and plan IDs, contract ID, provider names, target path digests, target after-hashes, approval hash, and apply time. It excludes prompts, document bodies, raw settings, hook commands, credentials, absolute paths, and provider output. Apply failure restores configuration before the event and emits no success event.

## Consequences

Direct terminal users can make ordinary requests without manually running `lervo knowledge query`, and existing settings and hooks continue. Context failures fail closed, and stale tracked knowledge blocks normal `Stop`. This integration does not replace managed execution: work requiring managed write authorization, provider receipts, verification, or full coverage must use `lervo run`.

## References

- [Codex hooks](https://learn.chatgpt.com/docs/hooks)
- [Codex AGENTS.md guidance](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [Claude Code hooks](https://code.claude.com/docs/en/hooks)
- [Claude Code settings](https://code.claude.com/docs/en/configuration)
- [Managed provider lifecycle](0011-managed-provider-run-lifecycle.md)
- [Unmanaged terminal context observation](0197-unmanaged-terminal-context-observation.md)
- [Semantic repository migration](../../knowledge/repository/0193-semantic-repository-and-agent-surface-migration.md)
