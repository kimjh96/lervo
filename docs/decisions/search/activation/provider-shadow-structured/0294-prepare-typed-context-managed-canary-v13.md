# ADR-0294: Prepare typed-context managed canary v13

Status: `accepted`
Date: 2026-08-29

## Context

Managed canary v12 completed all eight Codex and eight Claude native-session tasks. Its prompt-only E4 constraint left two Claude precision failures and introduced two Codex recall failures, so ADR-0292 rejected and rolled back the instruction. ADR-0293 introduced the provider-neutral `task_evidence` and `governance_context` delivery roles and proved common adapter behavior without provider calls.

A fresh measurement requires an exact checkpoint that preserves the immutable v12 cases and gates while binding the implemented typed boundary. Preparing it must not authorize provider calls or product activation.

## Decision

Prepare managed canary v13 with the same four v12 cases, two repetitions, paired ordering, deterministic selection, eight Codex tasks, eight Claude tasks, native signed-in sessions, zero selection calls, and unchanged recall and precision gates.

Bind the exact v12 prepared-manifest and observation-set digests as terminal negative predecessor evidence. Bind the current typed schema, reference serialization, and Codex-Claude parity-test source digests in the reviewed contract. The prepared manifest also binds the exact Git HEAD, working-tree status digest, built CLI digest, schedule digest, and default-off rollback predecessor.

The v13 entrypoint exposes only `prepare` and `status`, with no authorization or execution operation. The checkpoint records a 16-task-call ceiling for later review but grants zero Codex calls, zero Claude calls, zero managed-context effects, and zero production effects. Any live run requires separate exact operator authorization.

## Consequences

V13 can be reviewed against exact current implementation and build bytes without consuming provider budget. The immutable v12 observations are not retried, repaired, filtered, or reclassified. The proposed native-session task path requires no API key, but preparation starts no session.

Passing provider-free preparation establishes only checkpoint integrity. It makes no claim about speed, token savings, billed cost, recall, precision, provider compliance, or activation readiness.

## Verification

- Prove exact v12 population and acceptance-gate equality in the v13 contract test.
- Verify the typed-boundary source digests and reviewed contract digest.
- Build the CLI before preparing one owner-only immutable manifest.
- Verify 8+8 scheduled tasks, zero selection calls, zero provider calls, false execution authority, exact source and build digests, and the default-off rollback predecessor.
- Run quality, documentation, knowledge, full-repository, and exact-base release-completion checks.

## References

- [Typed task-evidence boundary](0293-type-task-evidence-and-governance-context.md)
- [Prompt-only correction rejection](0292-reject-prompt-only-e4-constraint-after-managed-canary-v12.md)
- [Managed canary v12 terminal evidence](../../../../evidence/search/provider-shadow/linked-evidence-managed-canary-v12.md)
- [Managed canary specification](../../../../specifications/execution/managed-linked-evidence-canary.md)
