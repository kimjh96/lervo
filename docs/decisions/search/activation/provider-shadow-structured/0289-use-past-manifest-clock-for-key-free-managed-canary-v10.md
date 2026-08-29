# ADR-0289: Use a past manifest clock for key-free managed canary v10

Status: `accepted`
Date: 2026-08-29

## Context

[V9](../../../../evidence/search/provider-shadow/linked-evidence-managed-canary-v9.md) removed the fixed experiment clock. Runtime search then produced a recommendation batch ID different from the exact prepared authorization, so deterministic selection correctly stopped before adapter creation. No model turn, usage, or Claude run occurred.

The prepared identity requires the same search nonce and observed time. The v8 time of 10:55 is now earlier than the live adapter and coordinator clock, preserving the exact batch ID without creating an apparently future recommendation.

## Decision

Restore the manifest-bound clock in the canary harness and set v10 `observedAtStart` to 10:55. Preserve v9 without retry. Keep the same paired population, read-only `canary-researcher` role, deterministic selection, native signed-in sessions, zero selection calls, no user API keys, no retries, no writes, and default-off product state.

## Consequences

V10 preserves exact authorization identity and context temporal validity. This bounded experiment-harness correction does not authorize product activation.

## Verification

- Prove that the prepared recommendation batch and authorization coordinates match.
- Execute one run at a time and stop at the first technical failure.
- Complete and report all 8 Codex and 8 Claude samples only when every run succeeds.

## References

- [V9 terminal evidence](../../../../evidence/search/provider-shadow/linked-evidence-managed-canary-v9.md)
- [Managed canary specification](../../../../specifications/execution/managed-linked-evidence-canary.md)
