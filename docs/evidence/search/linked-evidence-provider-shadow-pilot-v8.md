# Two-source Claude provider-shadow v8

Status: `completed_failed_accuracy_gate`
Date: 2026-08-29

## Result

V8 produced three technically eligible Claude observations under the global two-source maximum. Compatibility, schema parsing, usage, framing, privacy, replay, and no-effect checks passed. Accuracy failed: mean recall and precision were each 50%, against gates requiring 100% minimum per-case recall, 65% mean precision, and 50% minimum precision.

The cases selected one of two expected documents, two of two, and zero of one. The global cap reduced redundant selections but omitted ground-truth evidence. It is rejected without retry or threshold changes.

## Measurements

- Duration: 118,987 ms total; 39,662 ms mean; 42,913 ms median; 43,542 ms p95.
- Observed usage: 173,662 input tokens, 36,620 cached input tokens, 7,817 output tokens, and 181,479 total tokens. These SDK estimates are not billing data.
- Candidate bodies: 319,657 visible bytes; 49,268 selected-body bytes.
- Body-byte reduction after selection: 270,389 bytes, or 84.59%.
- Candidate-count reduction: 34 of 40, or 85%.
- Structured-output framing: exactly one event per observation; zero commands or additional tool events.
- Privacy failures, replay mismatches, unavailable observations, and primary-effect differences: zero.

Compared with v7, mean duration was 12.01% lower and body-byte reduction improved by 7.22 percentage points, but the case mix changed and recall fell from 100% to 50%. Neither difference establishes causal speed or savings.

## Disposition

V8 fails and does not authorize a paired Codex-Claude run. The two-source cap is not a safe correction. Further progress requires a separately designed selection-quality intervention, not another cap or threshold adjustment.

## References

- [Exact v8 overlay](../../../benchmarks/search/linked-evidence-provider-shadow-pilot-v8.json)
- [ADR-0261](../../decisions/search/activation/0261-bound-provider-shadow-selection-to-two-sources-v8.md)
- [V7 evidence](linked-evidence-provider-shadow-pilot-v7.md)
