# ADR-0339: Calibrate the short-profile performance measurement floor

- Status: `accepted`
- Decision date: 2026-09-02

## Context

The FH3 performance protocol compares 200 alternating baseline and candidate pairs from
the same fixture snapshot. Its absolute prompt and Stop budgets remain seconds-scale, but
the relative p95 gate originally used a 10-millisecond floor for short profiles. The
declared environment intentionally does not control OS cache state, power mode, or
competing workloads.

Three complete source-bound observations under the same implementation rejected different
profiles at the relative gate while every absolute budget and correctness gate passed.
The rejected p95 differences were 12.361 milliseconds for a small warm prompt, 13.386
milliseconds for a small cold prompt, and 23.647 milliseconds for the four-hook concurrent
batch. A separately repeated 200-pair Stop profile measured a 7.902-millisecond p95
difference and passed. The moving failure coordinate, small absolute differences, and
uncontrolled competing load show that the 10-millisecond floor cannot reliably distinguish
a product regression from local tail variation. Repeating until one report happens to pass
would select evidence after observing the outcome.

## Decision

Retain the alternating paired protocol, exact fixture snapshots, 200-pair foundation run,
nearest-rank p95 observation, 10-percent relative rule, absolute prompt and Stop budgets,
correctness gates, and no-exception policy. Change only the fixed short-profile measurement
floor from 10 to 25 milliseconds. A profile fails relative regression when both:

- candidate p95 is more than 1.10 times baseline p95; and
- candidate p95 exceeds baseline p95 by more than
  `max(25 milliseconds, baseline p95 * 0.10)`.

The budget calculation has one pure owner in `@lervo/execution-performance`; the benchmark
runner and independent report verifier call the same function. The protocol digest changes,
so an earlier report cannot validate under the calibrated decision. Tests keep 25
milliseconds accepted and 26 milliseconds rejected for a 70-millisecond baseline.

This decision supersedes only the 10-millisecond short-profile floor in ADR-0335. It does
not relax the 10-percent rule for profiles whose baseline p95 is at least 250 milliseconds,
raise an external latency budget, introduce a result-specific exception, or make a failed
or stale report acceptable.

## Consequences

Short local profiles tolerate a bounded amount of documented filesystem and scheduling
tail variation while material or persistent regressions still fail. Every accepted report
continues to expose the actual baseline and candidate distributions, ratio, absolute
difference, applicable allowance, signed paired overhead, environment, and population.

The 25-millisecond floor is a protocol constant rather than a claim that instrumentation
costs 25 milliseconds. A future change must use another reviewed protocol digest and new
evidence; it cannot mutate a generated report or add an exception after observation.

## References

- [ADR-0335](0335-record-and-verify-bounded-execution-stage-evidence.md)
- [Execution stage observation and performance](../../../specifications/execution/stage-observation-and-performance.md)
- [Foundation execution performance evidence](../../../evidence/foundation/execution-performance-v1.md)
