# Emitted instructions and compatibility limits

In retrieval mode, `apps/cli/src/terminal-prompt-context.ts` selects worker or root instructions from the workspace binding.

## Worker instructions

The worker branch restricts changes to assignment-scoped paths. It describes Stop checks for ownership marker, writer session, assignment lease, exact workspace revision, and path-scoped diff, followed by a workspace checkpoint. The function emits but neither performs nor verifies these checks.

Worker instructions prohibit advancing the repository-wide workstream or repairing another workspace's knowledge movement. They direct commits only when required by the task or sealing flow and keep the repository-wide workstream informational.

## Repository-long instruction review

For an explicit repository-long instruction, the preamble directs the agent to:

1. Submit the exact request through `lervo knowledge instruction intake --provider <provider> --stdin`.
2. Inspect returned Markdown and candidate hash.
3. Use `lervo knowledge instruction review` for the exact apply or reject decision.

It prohibits inferred durability or approval. Prompt assembly performs neither intake nor review and materializes no rule.

## Root completion instructions

For a root repository-changing turn, emitted instructions require this order: verification, final commit or byte change, workstream advancement, knowledge refresh, then `lervo terminal declare`. Later repository-authored changes or commits make the declaration stale. Read-only turns need no declaration.

Presented declaration fields are task mode, canonicalization disposition and exact v1 outcome, knowledge disposition, deliberation disposition, and deliberation ID.

Emitted canonicalization outcomes are:

- Canonical update with exact target hashes and source paths.
- No durable change with an implementation-only, verification-only, already-canonical, or transient reason.
- Review draft with exact proposed Markdown and hash.
- Portable-skill candidate with a bounded development-pattern proposal.

Every changed noncanonical source must be bound exactly once. The portable-skill instruction requires at least two independent groups binding distinct current passed verification events and exact source, skill, resource, input, output, tool, and permission contracts. Retrieval selection and provider agreement do not satisfy this gate. The function emits the gate but does not validate proposals, promote candidates, or establish approval.

Root instructions request checkpoint creation or advancement by the agent. Declaration is described as an unmanaged agent claim checked elsewhere; proposal bodies remain confined to local candidate state.

## Version compatibility limit

The assembler has no event-writer-version or installed-background-owner switch and emits synchronous root knowledge-finalization wording. ADR-0433 preserves synchronous declarations until the core owner is verified and retains separate installed activation evidence requirements.

The supplied assembler cannot establish that callers select compatible wording for every installed version or that background convergence has completed. Its emitted instructions must not serve as evidence of either guarantee.
