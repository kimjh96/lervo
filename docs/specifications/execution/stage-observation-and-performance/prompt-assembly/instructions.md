# Emitted instructions and compatibility limits

Compact context carries the root declaration instruction from `apps/cli/src/terminal-declaration-instruction.ts`. Worker attachment and assignment scope come from the compact helper ([compact assembly](../compact-terminal-context/compact-assembly.md)). The retrieval preamble's worker and repository-long instruction text went with retrieval mode ([ADR-0634](../../../../decisions/execution/providers/hooks/0634-remove-the-retrieval-terminal-context-mode.md)); AGENTS.md carries owner-rule intake.

## Root completion instructions

For a root repository-changing turn, emitted instructions require this order: verification, final commit or byte change, workstream advancement, knowledge refresh, then `lervo terminal declare`. Later repository-authored changes or commits make the declaration stale. Read-only turns need no declaration.

Presented declaration fields are task mode, canonicalization disposition and exact v1 outcome, knowledge disposition, deliberation disposition, and deliberation ID.

Emitted canonicalization outcomes are:

- Canonical update with exact target hashes and source paths.
- No durable change with an implementation-only, verification-only, already-canonical, or transient reason.
- Review draft with exact proposed Markdown and hash.

Every changed noncanonical source must be bound exactly once. The function emits these instructions but does not validate outcomes, promote candidates, or establish approval.

Root instructions request checkpoint creation or advancement by the agent. Declaration is described as an unmanaged agent claim checked elsewhere; proposal bodies remain confined to local candidate state.

## Version compatibility limit

The assembler has no event-writer-version or installed-background-owner switch and emits synchronous root knowledge-finalization wording. ADR-0433 preserves synchronous declarations until the core owner is verified and retains separate installed activation evidence requirements.

The supplied assembler cannot establish that callers select compatible wording for every installed version or that background convergence has completed. Its emitted instructions must not serve as evidence of either guarantee.
