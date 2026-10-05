# Prompt assembly and emitted completion instructions

`apps/cli/src/terminal-prompt-context.ts` assembles retrieval context and selects workspace-based instructions only when `LERVO_TERMINAL_CONTEXT` is exactly `retrieval`. An absent variable or any other value selects compact mode.

- [Retrieval context and boundaries](prompt-assembly/retrieval.md)
- [Emitted instructions and compatibility limits](prompt-assembly/instructions.md)

## Compact mode

At entry, compact mode returns `prepareCompactTerminalPromptContext` with the original input and the string from `terminalDeclarationInstruction(provider, observationId)`. This precedes retrieval input preparation, attention assembly, selection, document loading, and this module's worker-specific instruction branch.

The compact helper receives the workspace binding through the original input. Its implementation must be inspected to establish binding handling or declaration-string rendering. This assembler alone establishes neither compact worker instruction parity nor a health-dependent declaration policy.

## Test and performance evidence

`apps/cli/test/terminal-integration.test.ts` explicitly selects retrieval mode for broad integration cases. Separate compact fixtures assert:

- A continuation headline without provider query projection or loaded README text.
- Context below 6 KiB in that fixture.
- A prefix workstream observation.

Additional fixtures assert that knowledge snapshot identity is reused for an exact repository revision and changes after a README revision, and that `terminalTurnDeclarationRequired` changes from true to false after an idle knowledge resident health record is recorded.

These are test definitions, not observed passes, installed activation evidence, a universal compact byte limit, or proof of completed background convergence. Historical retrieval latency cohorts establish neither compact-mode nor current-build performance.

[Terminal preparation and snapshot delegation](terminal-preparation-and-snapshots.md) records preparation and cache call boundaries.
