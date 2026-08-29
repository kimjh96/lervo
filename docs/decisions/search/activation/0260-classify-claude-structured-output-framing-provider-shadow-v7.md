# ADR-0260: Classify Claude structured-output framing for provider-shadow v7

Status: `accepted`
Date: 2026-08-29

## Context

[Provider-shadow v6](../../../evidence/search/linked-evidence-provider-shadow-pilot-v6.md) classified one completed Claude turn as `provider_shadow_tool_activity`. The Claude Agent SDK implements JSON Schema output through an end-turn tool session, followed on success by the `structured_output` attachment. Because the experiment exposed no ordinary Claude tools, its zero-tool rule conflated provider-native output framing with repository or execution tool activity.

## Decision

For a Claude session configured with JSON Schema output and an empty ordinary tool list, permit at most one completed normalized tool event as structured-output framing. Continue to reject every command and any second tool event.

A turn is eligible only when:

- usage is complete;
- the structured result is present;
- the exact closed token schema parses;
- all accuracy thresholds pass; and
- all no-effect checks pass.

Record `structuredOutputFramingToolCount` in eligible observations. This is not an operational tool-use claim and does not change core provider events or managed execution behavior.

Run a fresh, fail-first, Claude-only v7 micro-pilot on three repetition-two phase-A samples using fresh `psv7_` coordinates. Allow at most three calls and no retries, replacements, repair turns, answer turns, or publication calls. The cumulative v2-v7 ceiling is 60 calls.

## Consequences

Passing v7 authorizes only a separately reviewed, fresh, paired 24-by-24 Codex-Claude rerun. No prior Codex or Claude result may be borrowed.

## Verification

- Test fresh repetition-two scheduling, exact v7 contract binding, and bounded framing configuration.
- Preserve zero allowed tool events for all legacy and non-structured runs.
- Execute v7 once, stop at the first failure, and perform exact review.
- Publish compatibility, accuracy, duration, token, and candidate-byte measurements without a billed-cost claim.
- Complete quality, documentation, knowledge, repository, and task-base release checks.

## References

- [ADR-0259](0259-preserve-claude-selection-failure-provider-shadow-v6.md)
- [V6 evidence](../../../evidence/search/linked-evidence-provider-shadow-pilot-v6.md)
- [Exact v7 contract](../../../../benchmarks/search/linked-evidence-provider-shadow-pilot-v7.json)
