# ADR-0528: Remove the linked-evidence canary and shadow

Status: `accepted`
Decision date: 2026-10-24
Amends: [ADR-0302](provider-shadow-structured/typed-context/0302-retire-linked-default-and-use-search-engine-ports.md) (retained canary and shadow)

## Context

[ADR-0302](provider-shadow-structured/typed-context/0302-retire-linked-default-and-use-search-engine-ports.md) retired the ordinary linked-evidence default on 2026-08-30, after a paired evaluation lowered claim recall. It kept the exact-authorized canary default-off, together with its contracts, tests, and records, as historical experiment infrastructure.

Some of that infrastructure still ran in production:

- The linked-evidence shadow ran on every managed run and every Node conversation that prepared search context, at `managed-search-context.ts` and `managed-operational-search-context.ts`. It loaded the registered corpus, projected linked sources, and stored an observation that nothing read.
- The canary's request field, authorization type, selection boundary, and paired-evaluation seam stayed in the managed run path and its dependency types.

No public CLI input could authorize the canary, so the retained code served only scripts that reproduced experiments v1 to v18. Those scripts drove the canary through built CLI modules. They could not run without that code.

## Decision

Remove the canary, the shadow, and every path that only they used:

- **CLI:** seven `apps/cli/src/managed-linked-evidence-*` modules. Also the `linkedEvidenceCanaryAuthorization` request field, the `resolveExperimentalLinkedEvidenceSelection` seam, and the `selectionBoundary` adapter option, which no remaining caller passes.
- **Context:** four `packages/context` modules and the `linkedEvidenceSelections` and `defaultLinkedEvidenceSelections` inputs.
- **Repository context:** the shadow call in both search-context paths, and their now-unused `runId` input.
- **Search storage:** the shadow and canary stores in `packages/search-local`.
- **Scripts:** fifty evaluation scripts and tests that import the removed code directly or transitively. These are the canary v1 to v18 runners and contract tests, the phase-A shadow pilot, and the lexical-linked uplift runner. Their `package.json` entries are removed, and the script architecture keeps no evidence-bound root exception.

Keep the following:

- The `benchmarks/search` contracts and every evidence document. They record what the experiments observed and need no runtime.
- The provider-shadow pilot scripts that use provider adapters directly.
- The adapter-level read-only, no-tool transports. Other features can use them.
- The managed linked-evidence specification and the adapter selection-boundary specification, marked historical, because accepted decisions link to them.

## Consequences

Managed runs and Node conversations no longer load the registered corpus or write a shadow observation when they prepare search context. Stored canary and shadow records stay on disk as local state, with no writer or reader.

Reproducing a linked-evidence experiment now requires checking out a revision before this decision. Results stay available in the evidence documents and benchmark contracts.

A future relation or linked-context mechanism must enter through the search-engine port and a paired comparison, as ADR-0302 and [ADR-0523](0523-retire-reviewed-relation-context.md) require.

## Verification

- `pnpm typecheck`, `pnpm repository-scripts:check` (0 evidence-bound exceptions), `pnpm evaluation:natural-language:check`, `pnpm docs:check`, and `pnpm code-convention:check` pass.
- Managed run, managed knowledge context, context, repository-context, search-local, and Node conversation tests pass without the canary and shadow cases.
