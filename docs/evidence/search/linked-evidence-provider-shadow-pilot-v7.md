# Claude output-framing provider-shadow v7

Status: `completed_failed_accuracy_gate`
Date: 2026-08-29

## Result

V7 produced three eligible Claude observations from three attempts. JSON Schema output, exact token parsing, complete usage, bounded output framing, privacy, replay, and every no-effect check passed. Reviewed expected-path recall was 100% in every case, but selection precision failed both gates: mean precision was 52.22% against 65%, and the minimum was 40% against 50%.

Claude selected 10 of 36 candidates: all five reviewed relevant documents and five unexpected documents. Per-case selection counts were 5, 3, and 2, while reviewed relevant counts were 2, 2, and 1.

## Measurements

- Duration: 135,233 ms total; 45,078 ms mean; 48,376 ms median; 50,384 ms p95.
- Observed usage: 120,497 input tokens, 1,465 cached input tokens, 8,356 output tokens, and 128,853 total tokens. These are SDK estimates, not billing data.
- Candidate bodies: 284,723 visible bytes; selected bodies: 64,438 bytes.
- Body-byte reduction: 220,285 bytes, or 77.37%.
- Candidate-count reduction: 26 of 36, or 72.22%.
- Structured-output framing: exactly one event per observation; commands and additional tool events: zero.
- Privacy failures, replay mismatches, unavailable observations, and primary-effect differences: zero.

## Disposition

V7 proves Claude structured-selection compatibility but fails the preregistered accuracy gate because of redundant selections. It neither authorizes a paired Codex-Claude rerun nor permits combination with the prior single Codex observation.

Each of the six reviewed eligible cases requires at most two expected documents. The next bounded candidate is a provider-neutral global cap of two sources. It must preserve 100% recall on fresh samples without case-specific routing or a threshold change.

## References

- [Exact v7 contract](../../../benchmarks/search/linked-evidence-provider-shadow-pilot-v7.json)
- [ADR-0260](../../decisions/search/activation/0260-classify-claude-structured-output-framing-provider-shadow-v7.md)
- [V6 evidence](linked-evidence-provider-shadow-pilot-v6.md)
