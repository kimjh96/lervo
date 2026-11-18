# Semantic durable-rule intake contract

## Classification, not a gate

The reusable grounding contract may carry one exact-key durable-instruction assessment, with an optional `replaces` list of older catalog entries the rule supersedes. [ADR-0561](../../decisions/foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md) removed the former automatic gate. Every grounded rule is stored; its authority, operation, risk, conflict, confidence, and scope are recorded as classification. Unspecified scope means repository-wide. Examples, quotations, hypotheticals, complaints, questions, and current-task commands are not rules (`none`), and temporary directives are `workstream`. The only check before storage is fidelity to the owner's words, as defined in the [durable-instruction intake specification](../../specifications/execution/events-and-privacy/knowledge-and-terminal-integration/durable-instruction-intake.md).

## Materialization and retained evidence

Eligible output is one deterministic Lervo-generated Markdown source under `docs/instructions/generated/`, with its path determined by semantic identity. It contains neither prompt prose nor per-run or snapshot identifiers. Local events retain only request and resolver digests plus materialized coordinates.

Repeated identical intake is current. Same-rule bytes with a changed classification are updated. A conflicting older Lervo-generated rule in the same scope is replaced and deleted in the same transaction; user-owned instruction files are never deleted. No proposal remains pending: a rule whose text is not grounded yet waits in the retained capture queue. Inferred reusable behavior has no active development-pattern intake after [ADR-0533](../../decisions/knowledge/repository/canonicalization/patterns/0533-remove-the-development-pattern-pipeline.md). [ADR-0543](../../decisions/knowledge/repository/canonicalization/patterns/0543-learn-portable-skills-from-practice-in-the-knowledge-resident.md) defines separate background practice learning from completed work, with independent review and delegation-scoped materialization. Its standalone resident path is wired in source, with practice events gated by schema 8 reader activation. Hub typed candidate and usage exchange remains a bounded follow-up.

## Consumer authority

ADR-0327 supersedes automatic intake for direct unmanaged terminals: prompt preparation performs retrieval only, emits `unmanaged_terminal_retrieval_only`, and never calls the materializer.

ADR-0376 installs the separate consumer through `knowledge instruction intake`. Under ADR-0561, intake stores and applies the rule itself; `knowledge instruction review` is removed and `knowledge instruction retire` is the undo. The candidate never stores the raw request, the hook never writes, and bounded active candidate state is removed after apply.
