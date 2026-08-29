# ADR-0286: Use a machine-output role for key-free managed canary v7

Status: `accepted`
Date: 2026-08-29

## Context

[V6](../../../../evidence/search/provider-shadow/linked-evidence-managed-canary-v6.md) stopped on ordinal 1 before adapter start. The built-in `researcher` role requires a resolved writing policy for human presentation, but the ordinary managed-run path passed null. This provider-neutral pre-turn contract mismatch was not a Codex or Claude model failure.

The task outputs are private experiment artifacts accepted through exact E1-E4 evidence and independent metrics. The built-in `developer` role uses machine presentation and a null writing policy, matching the managed-run input without weakening source, verification, read-only, or evidence requirements.

## Decision

Preserve v6 without retry. Prepare v7 over the same 16 paired tasks with `roleId: developer`.

Separate adapter creation from provider start in execution telemetry. Count a task provider call only when adapter start is invoked. Retain the exact deterministic selection policy, source population, native signed-in Codex and Claude models, zero selection calls, 16-task-call ceiling, no user API keys, no retries, no writes, and default-off product state.

## Consequences

V7 tests the intended linked-context effect without requiring the unrelated human-writing policy boundary. It neither fixes nor activates human-role managed runs; that independent product defect remains a bounded follow-up.

## Verification

- Bind v7 to the v6 terminal evidence and a fresh current source/build snapshot.
- Prove the developer role, zero selection adapters and calls, and distinct adapter-creation and provider-start counts.
- Execute fail-first, calculate complete paired measurements when technically possible, and exclude prompts, source bodies, result bodies, paths, and credentials from observations.

## References

- [V6 terminal evidence](../../../../evidence/search/provider-shadow/linked-evidence-managed-canary-v6.md)
- [Managed canary specification](../../../../specifications/execution/managed-linked-evidence-canary.md)
