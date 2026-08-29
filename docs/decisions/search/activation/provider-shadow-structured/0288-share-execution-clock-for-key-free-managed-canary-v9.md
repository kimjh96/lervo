# ADR-0288: Use the runtime clock for key-free managed canary v9

Status: `accepted`
Date: 2026-08-29

## Context

[V8](../../../../evidence/search/provider-shadow/linked-evidence-managed-canary-v8.md) resolved the machine-facing read-only role and created a native Codex session, then stopped during context preparation. Search used the injected experiment clock at 10:55, while the provider coordinator omitted that dependency and used the actual clock at 10:51. The context contract correctly rejected the apparently future recommendation. No model turn or usage event occurred, and Claude was not reached.

## Decision

Remove the fixed future clock from the canary harness so search, provider adapters, coordination, evidence, and finalization share the advancing runtime clock. Preserve v8 without retry. Prepare v9 over the same 16 paired tasks with the same read-only `canary-researcher` role, deterministic selection, native signed-in sessions, zero selection calls, no user API keys, no retries, no writes, and default-off product state.

## Consequences

The harness retains deterministic identities and exact source bindings without manufacturing event time. This corrects a provider-neutral experiment defect and does not authorize product activation.

## Verification

- Run the existing managed Codex and Claude vertical-slice tests unchanged.
- Bind v9 to the exact v8 terminal observation and a fresh built CLI and repository snapshot.
- Execute fail-first and report only measured provider turns and usage.

## References

- [V8 terminal evidence](../../../../evidence/search/provider-shadow/linked-evidence-managed-canary-v8.md)
- [Managed canary specification](../../../../specifications/execution/managed-linked-evidence-canary.md)
