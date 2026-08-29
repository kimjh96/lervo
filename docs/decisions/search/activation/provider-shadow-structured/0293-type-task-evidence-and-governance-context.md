# ADR-0293: Type task evidence and governance context

Status: `accepted`
Date: 2026-08-29

## Context

Managed canary v12 showed that prose could not reliably identify which supplied documents should receive E4 references. Claude cited behavior and governance sources in two runs, while stricter wording caused Codex to omit required task sources in two runs. ADR-0292 rejected and rolled back that prompt-only correction.

The provider-neutral context envelope gave every document the same shape and an E4 token, requiring providers to infer whether instructions, workstreams, writing policies, protocols, or substantive repository sources were referenceable.

## Decision

Require `documentRole` metadata on every context-envelope and context-receipt document. Allowed values are `task_evidence` and `governance_context`.

- Repository instructions, current workstreams, writing policies, and machine protocols are governance context. Search, graph, linked-evidence, handoff, path-rule, and ordinary registry sources are task evidence unless the exact document is also selected as governance context. Governance wins for dual-role documents.
- Context planning, E2 loading, materialization, E3 envelope construction, and the E3 adapter receipt preserve the role. A missing, unknown, or changed role is a contract failure. A receipt role mismatch fails as `context_receipt_mismatch` before E3 evidence is accepted.
- Codex and Claude serialize identical role metadata. Only `task_evidence` documents receive an exact `evidenceToken`. Governance documents receive `evidenceToken: null` plus an instruction that they control behavior and must not be cited.
- Raw E4 observation is unchanged. If provider output contains an exact token for an injected governance document, the observer records it; the runtime does not filter, repair, or reclassify output against the role or evaluation ground truth.

`documentRole` is a low-cardinality, provider-neutral contract field. It contains no source body, path, credential, provider configuration, evaluation identifier, or user secret. This change adds no event type, activation state, provider call authority, retry authority, or production rollout.

## Consequences

Reference eligibility is explicit in the controlled envelope rather than reconstructed by each provider from prose. Existing E1-E4 meanings are unchanged: the role proves classification and delivery only, not provider acceptance, attention, use, correctness, or compliance.

The common adapter suite rejects role substitution and proves equivalent Codex and Claude serialization, including null governance tokens and exact task-evidence tokens. A fresh paired canary still requires a separate exact checkpoint and authorization. Product activation remains default-off.

## Verification

- Validate required envelope and receipt roles through the shared schema.
- Prove instruction, workstream, writing-policy, search, graph, and linked-evidence classification through context and delivery tests.
- Run common adapter receipt-mismatch tests and Codex-Claude serialization parity tests without provider calls.
- Run quality, documentation, knowledge, build, full-repository, and base-bound release-completion checks.

## References

- [Prompt-only correction rejection](0292-reject-prompt-only-e4-constraint-after-managed-canary-v12.md)
- [Managed canary specification](../../../../specifications/execution/managed-linked-evidence-canary.md)
- [Provider adapter specification](../../../../specifications/execution/provider-adapters.md)
