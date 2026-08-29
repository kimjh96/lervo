# ADR-0292: Reject prompt-only E4 constraint after managed canary v12

Status: `accepted`
Date: 2026-08-29

## Context

[ADR-0291](0291-constrain-provider-neutral-e4-references-for-managed-canary-v12.md) authorized one request-side E4 instruction correction and a fresh paired managed canary. V12 completed all eight Codex and eight Claude native-session runs without technical failures, retries, selection calls, API keys, or repository mutations.

The prompt-only constraint failed the unchanged accuracy gates. Claude mean reference precision improved from 50.14% in v11 to 65.97%, but two runs remained below the 50% per-run minimum, with a 22.22% minimum. Codex mean precision improved from 81.25% to 91.67%, but two runs omitted one of two expected sources; mean recall fell from 100% to 87.5%, with a 50% minimum.

## Decision

Reject the prompt-only E4 constraint and restore the prior provider-neutral reference instruction after preserving the exact v12 build, manifest, authorization, attempts, and observations. Do not reclassify, filter, repair, retry, or replace any v12 result. Keep product activation default-off.

Any successor must represent the distinction between task-evidence context and behavior or governance context in a provider-neutral typed delivery contract before asking providers to emit references. It must keep raw-output token observation unchanged, hide expected evaluation identifiers, and prove common Codex and Claude adapter behavior before receiving any fresh paired call budget.

## Consequences

V12 remains valid negative evidence for prompt-only control but is not a product candidate. The failed instruction is not retained as current runtime behavior. The next design must resolve context-role ambiguity structurally instead of relying on providers to infer it from prose.

## Verification

- Restore the pre-v12 reference instruction and rebuild affected packages.
- Keep the v12 checkpoint contract and historical instruction digest for exact replay.
- Run adapter, managed-canary, quality, documentation, knowledge, and exact-base release-completion checks.
- Verify activation remains default-off and no v12 observation changes.

## References

- [Managed canary v12 terminal evidence](../../../../evidence/search/provider-shadow/linked-evidence-managed-canary-v12.md)
- [Managed canary v11 terminal evidence](../../../../evidence/search/provider-shadow/linked-evidence-managed-canary-v11.md)
- [Managed canary specification](../../../../specifications/execution/managed-linked-evidence-canary.md)
