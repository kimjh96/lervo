# ADR-0290: Forward linked selections for key-free managed canary v11

Status: `accepted`
Date: 2026-08-29

## Context

[V10](../../../../evidence/search/provider-shadow/linked-evidence-managed-canary-v10.md) completed its first Codex model turn but rejected the completion evidence. Deterministic selection produced six current linked documents, but none appeared in the E1 plan, E2 load set, or E3 injection evidence.

The context preparation boundary accepted `linkedEvidenceSelections` but did not pass it to the context planner. The planner and loader already supported the required behavior, so the omission removed the canary selections before E1.

## Decision

Forward `linkedEvidenceSelections` from `prepareContext` to `createContextPlan`. Add a regression test across the E1-to-E2 boundary that loads a linked document unavailable through the ordinary role-selection path. Rebuild the context package before preparing v11.

Do not retry v10. Preserve the paired population, past manifest clock, read-only `canary-researcher` role, deterministic selection, native signed-in Codex and Claude sessions, zero selection calls, no user API keys, no retries, no writes, and default-off product state.

## Consequences

V11 can test whether deterministic linked selections survive E1 planning, E2 loading, E3 injection, and E4 use. The correction does not change provider adapters or authorize product activation.

## Verification

- Run the context-forwarding regression and managed-canary contract tests.
- Rebuild the affected package, then prepare and authorize one exact v11 manifest.
- Execute one run at a time and stop at the first technical failure.
- Complete and report all eight Codex and eight Claude samples only if every run succeeds.

## References

- [V10 terminal evidence](../../../../evidence/search/provider-shadow/linked-evidence-managed-canary-v10.md)
- [Managed canary specification](../../../../specifications/execution/managed-linked-evidence-canary.md)
