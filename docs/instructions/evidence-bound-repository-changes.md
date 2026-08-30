# Evidence-bound repository changes

Status: `active`
As of: 2026-08-26

Before changing user-owned repository bytes or durable lifecycle state:

1. Create a bounded, content-bound plan naming every target and intended disposition, binding current hashes and policy inputs, and specifying the verification required for review.
2. Apply only after exact plan approval.
3. Recheck the same bindings immediately before mutation.

Keep provider behavior outside this contract. Plans and durable events must exclude source bodies, credentials, absolute paths, and unrestricted errors. Provider results, repeated observations, and matching model outputs are evidence for review only; they are never approval or proof of use.

Stage changes so prior bytes can be restored if persistence fails. Record success only after validation. If the durable event cannot commit, roll back repository changes and emit no success. Interrupted work must leave an explicit recovery marker and block conflicting mutation until recovery either restores the prior state or completes a proven commit.

Read-only inspection requires no apply authority. A replace-current projection may advance without invalidating an unrelated target, but every selected target and protection input remains content-bound. Before finishing, run the plan's declared verification commands and the repository completion contract.

## Canonicalization at completion

Assess durable outcomes using typed repository responsibility and ownership, never a natural-language keyword table:

- Put behavioral obligations in canonical instruction documents under `docs/instructions/`.
- Put product, architecture, and lifecycle facts in their responsible specification or decision.
- Put executable checks in repository verification.
- Put mutable next-step state only in the current workstream.
- Keep AGENTS as a fixed-size instruction bootstrap, not a route list or general knowledge store. Resolve task- and path-scoped sources through repository knowledge query.

When the responsible canonical source is already current, record that disposition without duplicating prose. When evidence suggests a reusable rule but does not authorize user-owned bytes, create a reviewable development-pattern candidate or a bounded pending decision. Candidate generation, provider agreement, repetition, and file presence grant neither promotion nor approval. A later exact review may promote the candidate through the responsibility-owned target and refresh repository knowledge.

One direct explicit user directive may create a separate Lervo-generated durable instruction only through the semantic gate defined by the lifecycle specification. It must be additive, low risk, repository-long, unambiguous, conflict-free against a complete bounded catalog, and high confidence. The isolated content-addressed target makes the effect reviewable and removable; it does not authorize rewriting an existing user-owned instruction.
