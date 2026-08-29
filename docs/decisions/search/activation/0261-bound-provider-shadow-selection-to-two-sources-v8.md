# ADR-0261: Bound provider-shadow selection to two sources in v8

Status: `accepted`
Date: 2026-08-29

## Context

[Provider-shadow v7](../../../evidence/search/linked-evidence-provider-shadow-pilot-v7.md) passed all three compatibility observations with 100% expected-path recall but failed precision because Claude selected redundant evidence. Each of the six human-reviewed eligible cases has one or two expected documents; the v7 global maximum of eight allowed avoidable over-selection.

## Decision

Set the provider-neutral structured-selection maximum to two sources for every v8 sample. Enforce the same limit in the closed JSON Schema, parser, and review gate. Do not add case-specific routing, expose expected counts, change ground truth, or reduce existing recall or precision thresholds.

Compose the exact v8 contract as a bounded overlay on the exact immutable v7 contract. Run three fresh Claude repetition-three samples on the three cases unused by v7, using fresh `psv8_` coordinates. Preserve the model, empty ordinary tool list, one structured-output framing event, complete usage, privacy, no-effect, first-failure, and no-retry boundaries. The cumulative v2-v8 ceiling is 63 calls.

## Consequences

Passing v8 authorizes only a separately pre-registered, fresh, paired Codex-Claude measurement using the same two-source limit. It does not authorize borrowing prior results, canary traffic, or production activation.

## Verification

- Verify exact base and overlay digests, repetition-three scheduling, and the two-source schema bound.
- Execute v8 once and require three eligible observations with 100% recall and the existing precision gates.
- Publish exact accuracy, duration, usage, framing, and selected-byte evidence.
- Complete quality, documentation, knowledge, repository, and task-base release checks.

## References

- [ADR-0260](0260-classify-claude-structured-output-framing-provider-shadow-v7.md)
- [V7 evidence](../../../evidence/search/linked-evidence-provider-shadow-pilot-v7.md)
- [Exact v8 overlay](../../../../benchmarks/search/linked-evidence-provider-shadow-pilot-v8.json)
