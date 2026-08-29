# ADR-0291: Constrain provider-neutral E4 references for managed canary v12

Status: `accepted`
Date: 2026-08-29
Superseded by: [ADR-0292](0292-reject-prompt-only-e4-constraint-after-managed-canary-v12.md)

## Context

[V11](../../../../evidence/search/provider-shadow/linked-evidence-managed-canary-v11.md) completed all eight Codex and eight Claude source-task runs with 1.0 source recall, no technical failures, selection calls, or retries. Codex passed the unchanged precision gates. Claude referenced every expected source but also marked documents governing behavior or providing adjacent release and repository context. Three Claude runs fell below the 0.5 per-run precision minimum, and its mean precision was 0.5014 against the 0.65 provider minimum.

The provider-neutral managed-context instruction required marking every document explicitly relied on by the final response. It did not distinguish direct support for a necessary answer claim from operational context that was merely read or followed. Stored E4 observations are valid and must not be filtered or rewritten after provider output.

## Decision

Refine the shared adapter-contract instruction: append an E4 token only when its document directly supports an independently necessary substantive claim in the final response. Exclude tokens added merely because a document was supplied, read, followed, or used to govern behavior, process, role, style, or constraints. Require a final pass that removes every token whose document is unnecessary to support the substantive answer.

Keep token extraction and E4 telemetry unchanged. Do not expose reviewed expected document identifiers to either provider or post-filter observed references against evaluation ground truth.

Prepare v12 as a fresh paired confirmation using the same eight Codex and eight Claude source tasks, native signed-in sessions, deterministic selection, zero selection calls, no user API keys, no retries, no writes, unchanged recall and precision gates, and default-off product state.

## Consequences

Codex and Claude receive the same stricter rule through the provider-neutral adapter contract. V12 measures whether this request-side correction improves reference precision without hiding over-reference or reducing source recall. A passing v12 provides evidence for a separate activation decision; it does not activate the feature.

## Verification

- Verify the shared reference instruction and both adapter materializations through the adapter common contract tests.
- Build affected packages before preparing one exact v12 manifest.
- Execute one run at a time and stop at the first technical failure.
- Complete and report all eight Codex and eight Claude samples only if every run succeeds.
- Preserve v11 observations as immutable predecessor evidence.

## References

- [V11 terminal evidence](../../../../evidence/search/provider-shadow/linked-evidence-managed-canary-v11.md)
- [Managed canary specification](../../../../specifications/execution/managed-linked-evidence-canary.md)
