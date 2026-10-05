# Prompt assembly and emitted completion instructions

`apps/cli/src/terminal-prompt-context.ts` assembles current-repository retrieval context with a 28 KiB total bound, a 12 KiB maximum per loaded document, and an 8 KiB workstream context bound. Workstream truncation preserves UTF-8 character boundaries and appends an explicit notice. Selected publications go to the exact-loading helper; records retain content hash, full or prefix scope, delivered byte count, freshness, and assurance. Search, context assembly, and child exact loading receive distinct timing coordinates. Selected count and loaded-document count remain separate.

## Retrieval boundaries

Attention uses the exact lifecycle cache when available; a cache miss supplies unavailable coverage instead of a fresh lifecycle scan. Returned grounding state abstains with `unmanaged_terminal_retrieval_only`, empty effect coordinates, and ignored durable-instruction state. Empty local retrieval establishes no absence in another repository or external service. Standalone `lervo-ref` comments are requested only for explicit output references and do not prove acceptance, understanding, managed delivery, or use.

## Worker instructions

The worker branch emits instructions restricting changes to assignment-scoped paths. It describes Stop checks for ownership marker, writer session, assignment lease, exact workspace revision, and path-scoped diff, followed by a workspace checkpoint. It prohibits advancing the repository-wide workstream or repairing another workspace's knowledge movement, and directs commits only when the task or sealing flow requires them. The function emits these instructions but does not perform or verify the Stop checks.

## Repository-long instruction review

For an explicit repository-long instruction, the preamble directs the agent to submit the exact request through `lervo knowledge instruction intake --provider <provider> --stdin`, inspect returned Markdown and candidate hash, and use `lervo knowledge instruction review` for the exact apply or reject decision. It prohibits inferred durability or approval. Prompt assembly performs neither intake nor review and materializes no rule.

## Root completion instructions

For a root repository-changing turn, emitted instructions order verification, final commit or byte change, workstream advancement, and knowledge refresh before `lervo terminal declare`. Later repository-authored changes or commits make the declaration stale. Read-only turns need no declaration. Presented declaration fields are task mode, canonicalization disposition and exact v1 outcome, knowledge disposition, deliberation disposition, and deliberation ID.

Emitted canonicalization outcomes are:

- Canonical update with exact target hashes and source paths.
- No durable change with an implementation-only, verification-only, already-canonical, or transient reason.
- Review draft with exact proposed Markdown and hash.
- Portable-skill candidate with a bounded development-pattern proposal.

Every changed noncanonical source is to be bound exactly once. The portable-skill instruction requires at least two independent groups binding distinct current passed verification events and exact source, skill, resource, input, output, tool, and permission contracts. Retrieval selection and provider agreement do not satisfy this gate. The function emits the gate but does not validate proposals, promote candidates, or establish approval.

Root instructions request checkpoint creation or advancement by the agent; worker instructions keep the repository-wide workstream informational. Declaration is described as an unmanaged agent claim checked elsewhere, with proposal bodies confined to local candidate state.

## Version compatibility limit

The assembler selects worker or root instructions from the workspace binding. It has no event-writer-version or installed-background-owner switch and emits synchronous root knowledge-finalization wording. ADR-0433 preserves synchronous declarations until the core owner is verified and retains separate installed activation evidence requirements. The supplied assembler cannot establish that callers select compatible wording for every installed version or that background convergence has completed. Its emitted instructions must not serve as evidence of those guarantees.

## Current mode selection and scope qualification

The retrieval assembly and workspace-based instruction selection described above apply only when `LERVO_TERMINAL_CONTEXT` is exactly `retrieval`. An absent variable or any other value selects compact mode. At entry, compact mode returns `prepareCompactTerminalPromptContext` with the original input and the string produced by `terminalDeclarationInstruction(provider, observationId)`. This return precedes retrieval input preparation, attention assembly, selection, document loading, and the worker-specific instruction branch in this module.

The compact helper receives the workspace binding through the original input. Its implementation must be inspected to establish how it handles that binding or renders the supplied declaration string. This assembler alone does not establish compact worker instruction parity or a health-dependent declaration policy.

The supplied `apps/cli/test/terminal-integration.test.ts` explicitly sets retrieval mode for its broad integration cases. Its separate compact fixtures assert a continuation headline without provider query projection or loaded README text, context below 6 KiB in that fixture, and a prefix workstream observation. Additional fixtures assert that knowledge snapshot identity is reused for an exact repository revision and changes after a README revision, and that `terminalTurnDeclarationRequired` changes from true to false after recording an idle knowledge resident health record. These are test definitions, not observed passes, installed activation evidence, a universal compact byte limit, or proof of completed background convergence.

[Terminal preparation and snapshot delegation](terminal-preparation-and-snapshots.md) records the preparation and cache call boundaries. Historical retrieval latency cohorts do not establish compact-mode or current-build performance.
