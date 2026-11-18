# ADR-0339: Calibrate the short-profile performance measurement floor

- Status: `superseded`
- Decision date: 2026-09-02

Superseded by [ADR-0560](../../foundation/0560-remove-unused-subsystems-to-harden-the-core.md). Lervo no longer ships this capability.

## Context

The FH3 performance protocol compares 200 alternating baseline and candidate pairs from the same fixture snapshot. Its absolute prompt and Stop budgets are seconds-scale, but the original relative p95 gate used a 10-millisecond floor for short profiles. The declared environment intentionally does not control OS cache state, power mode, or competing workloads.

Three complete, source-bound observations of the same implementation rejected different profiles at the relative gate while passing every absolute budget and correctness gate. Rejected p95 differences were 12.361 milliseconds for a small warm prompt, 13.386 milliseconds for a small cold prompt, and 23.647 milliseconds for a four-hook concurrent batch. A separately repeated 200-pair Stop profile passed with a 7.902-millisecond p95 difference.

The moving failure coordinate, small absolute differences, and uncontrolled competing load show that the 10-millisecond floor cannot reliably distinguish product regression from local tail variation. Repeating runs until a report passes would select evidence after observing the outcome.

## Decision

Retain the alternating paired protocol, exact fixture snapshots, 200-pair foundation run, nearest-rank p95 observation, 10-percent relative rule, absolute prompt and Stop budgets, correctness gates, and no-exception policy. Change only the fixed short-profile measurement floor from 10 to 25 milliseconds.

A profile fails relative regression only when both conditions hold:

- candidate p95 is more than 1.10 times baseline p95; and
- candidate p95 exceeds baseline p95 by more than `max(25 milliseconds, baseline p95 * 0.10)`.

`@lervo/execution-performance` is the single pure owner of the budget calculation. The benchmark runner and independent report verifier call the same function. Because the protocol digest changes, earlier reports cannot validate under this calibrated decision. Tests accept 25 milliseconds and reject 26 milliseconds for a 70-millisecond baseline.

This decision supersedes only ADR-0335's 10-millisecond short-profile floor. It does not relax the 10-percent rule for profiles whose baseline p95 is at least 250 milliseconds, raise an external latency budget, introduce a result-specific exception, or make a failed or stale report acceptable.

## Consequences

Short local profiles tolerate a bounded amount of documented filesystem and scheduling tail variation, while material or persistent regressions still fail. Every accepted report continues to expose the actual baseline and candidate distributions, ratio, absolute difference, applicable allowance, signed paired overhead, environment, and population.

The 25-millisecond floor is a protocol constant, not a claim that instrumentation costs 25 milliseconds. Future changes require another reviewed protocol digest and new evidence; they cannot mutate a generated report or add an exception after observation.

## References

- [ADR-0335](0335-record-and-verify-bounded-execution-stage-evidence.md)
- [Execution stage observation and performance](../../../specifications/execution/stage-observation-and-performance.md)
- [Foundation execution performance evidence](../../../evidence/foundation/execution-performance-v1.md)
