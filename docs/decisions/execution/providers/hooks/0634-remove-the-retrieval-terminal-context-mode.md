# ADR-0634: Remove the retrieval terminal context mode

Status: `accepted`
Decision date: 2026-11-25
Amends: [ADR-0451](../../../knowledge/repository/canonicalization/0451-keep-terminal-hooks-off-the-developer-critical-path.md), [ADR-0531](0531-bound-terminal-hooks-and-retain-degraded-context.md), [ADR-0459](../../orchestration/improvement/0459-measure-context-hits-and-usage-on-every-channel.md)

## Context

Before 2026-10-04, every prompt ran a hidden provider call to project search queries, then retrieved and injected whole documents. Prompts waited 6.3–9.4 seconds, and each injected about 28 KB, mostly unrelated to the prompt. ADR-0451 made compact context the default and kept `LERVO_TERMINAL_CONTEXT=retrieval` to restore the old path unchanged. ADR-0531 and ADR-0459 carried that switch forward.

On 2026-11-25 the owner asked why the hook keeps two context modes. Evidence collected that day:

- No production code sets the variable. The CLI only reads it, in prompt context and the Stop prefetch condition.
- On the Mac host, no launch agent and no shell profile sets it.
- On the WSL host, nothing sets it, in a read-only check:
  - the Lervo systemd user units and their drop-ins, and the user manager's environment;
  - login profiles and system environment files;
  - the live environments of the running Lervo, Node runtime, and Hub processes;
  - each registered repository's `.envrc`, `.env`, and provider settings, and the user's provider settings.
- Only tests select retrieval mode.

The hook still carried two context paths. The change that routes a linked worktree's evidence to its registered repository had to special-case the unused one.

## Decision

- Every prompt takes compact context. Documents come on demand through `lervo knowledge query`, as AGENTS.md requires.
- Retrieval mode is removed with everything only it used:
  - the `LERVO_TERMINAL_CONTEXT` switch;
  - retrieval input preparation, assembly, candidate selection, and prompt-time document loading;
  - the retrieval preamble;
  - the hook's provider query projector and its CLI service wiring.
- The root declaration instruction that compact context carries moves to its own module.
- Stop always asks for the next compact prompt's knowledge-snapshot prefetch.
- The product-default search identity and retrieval plan in `@lervo/repository-context` stay, because `lervo knowledge query` and context quality use them.

## Consequences

- A host that still sets `LERVO_TERMINAL_CONTEXT=retrieval` gets compact context. Nothing fails.
- Tests that pinned retrieval output are removed. The compact fixtures and the hook lifecycle tests stay.
- No event type, schema, or stored event changes. Events recorded by retrieval-mode prompts stay readable.

## Verification

Focused tests show:

- the integration cases pass in compact context;
- Stop requests the prefetch with no mode switch;
- the session-start, failure-reason, owner-capture, health-prompt, and linked-worktree hooks pass without a query projector.

The ADR-0451 specifications for compact assembly, runtime dispatch, and prompt assembly now describe only compact context.
