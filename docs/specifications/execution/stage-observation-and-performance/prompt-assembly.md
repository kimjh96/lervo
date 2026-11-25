# Prompt assembly and emitted completion instructions

`apps/cli/src/terminal-prompt-context.ts` gives every prompt compact context. [ADR-0634](../../../decisions/execution/providers/hooks/0634-remove-the-retrieval-terminal-context-mode.md) removed the opt-in retrieval mode that ADR-0451 had kept: documents come on demand through `lervo knowledge query`, never through per-prompt retrieval.

- [Emitted instructions and compatibility limits](prompt-assembly/instructions.md)

## Compact context

`prepareTerminalPromptContext` returns `prepareCompactTerminalPromptContext` with the original input and the string from `terminalDeclarationInstruction(provider, observationId)`.

The compact helper renders observed worker attachment and assignment scope. It omits repository-wide workstream advancement for workers. Root declaration wording still depends on observed resident health. Failed prompt preparation starts independent base reads only on the degraded path. They share at most 2,500 ms within the remaining 15,000 ms hook budget and never turn missing freshness checks into current-state claims.

## Test and performance evidence

`apps/cli/test/terminal-integration.test.ts` runs its broad integration cases in compact context. Its compact fixtures assert:

- A continuation headline without provider query projection or loaded README text.
- Context below 6 KiB in that fixture.
- A prefix workstream observation.

Additional fixtures assert that knowledge snapshot identity is reused for an exact repository revision and changes after a README revision, and that `terminalTurnDeclarationRequired` changes from true to false after an idle knowledge resident health record is recorded.

These are test definitions, not observed passes, installed activation evidence, a universal compact byte limit, or proof of completed background convergence. Historical retrieval latency cohorts establish neither compact-mode nor current-build performance.

[Terminal preparation and snapshot delegation](terminal-preparation-and-snapshots.md) records preparation and cache call boundaries.
