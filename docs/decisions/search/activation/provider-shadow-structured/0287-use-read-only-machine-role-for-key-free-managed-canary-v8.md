# ADR-0287: Use a read-only machine role for key-free managed canary v8

Status: `accepted`
Date: 2026-08-29

## Context

[V7](../../../../evidence/search/provider-shadow/linked-evidence-managed-canary-v7.md) stopped during ordinal 1 in Codex adapter start. The built-in `developer` role removed the human writing-policy mismatch but authorizes filesystem writes. Because the canary creates its provider adapter with a read-only sandbox and no approvals, managed execution synchronously rejected the capability mismatch before any provider client or usage event existed. Claude was not reached. This provider-neutral role-to-sandbox contract error was not a model failure.

The isolated source repository now defines `canary-researcher`, which extends the reviewed developer contract while denying filesystem writes, shell execution, network access, external messages, deployment, and data mutation. It retains machine presentation and requires no human writing policy.

## Decision

Preserve v7 without retry. Prepare v8 over the same 16 paired source tasks with `roleId: canary-researcher`.

Retain deterministic all-current-candidate selection, native signed-in Codex and Claude transports, zero selection calls, a 16-task-call ceiling, no user API keys, no retries, no writes, immutable owner-only observations, and default-off product state.

Historical v6 and v7 observation records retain their original schema label. New observations use the provider-neutral `linked_evidence_managed_canary_observation.v2` record kind.

## Consequences

V8 can reach the provider boundary without granting a write capability the experiment neither needs nor permits. Passing measurements may support a later activation decision, but this decision does not authorize product activation.

## Verification

- Bind v8 to the exact v7 terminal observation and a fresh source/build snapshot.
- Resolve `canary-researcher` as machine-facing and read-only in the isolated repository.
- Execute fail-first and retain distinct adapter-creation, provider-start, usage, accuracy, and repository-status evidence without prompts, source bodies, result bodies, absolute paths, or credentials.
- Run focused contract tests, repository quality and full checks, knowledge lifecycle checks, and exact-base release completion.

## References

- [V7 terminal evidence](../../../../evidence/search/provider-shadow/linked-evidence-managed-canary-v7.md)
- [Managed canary specification](../../../../specifications/execution/managed-linked-evidence-canary.md)
