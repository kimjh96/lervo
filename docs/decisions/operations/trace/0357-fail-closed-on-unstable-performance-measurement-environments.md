# ADR-0357: Fail closed on unstable performance measurement environments

- Status: `superseded`
- Decision date: 2026-09-04

Superseded by [ADR-0560](../../foundation/0560-remove-unused-subsystems-to-harden-the-core.md). Lervo no longer ships this capability.

## Context

The foundation performance protocol alternates baseline and candidate arms, but the declared local environment does not control power mode, operating-system scheduling, or competing workloads. Existing reports expose each distribution but cannot distinguish an unstable baseline from a candidate-only regression in their machine-readable decisions.

A source-equivalent 200-pair diagnostic observation exposed this gap. The large warm prompt baseline moved from a 251.095 millisecond p50 to a 505.739 millisecond p95, while the candidate moved from a 257.063 millisecond p50 to a 564.768 millisecond p95. The 59.029 millisecond candidate regression exceeded the unchanged 50.5739 millisecond allowance. A later complete run from the same source produced a 7.695 millisecond regression, but selecting it would hide rather than explain the first observation.

Repository history provides separate calibration: stable deterministic baseline profiles normally keep p95 close to p50, while five retained host-contended observations exceeded three times their baseline p50. A conservative two-times boundary detects sustained baseline tail inflation without judging candidate instrumentation by its own distribution.

## Decision

`@lervo/execution-performance` owns one pure measurement-environment assessment in addition to its unchanged budget policy. A profile is `unstable` when baseline p95 exceeds two times baseline p50. If baseline p50 is zero and p95 is positive, the ratio is unavailable and the profile is also unstable. Equal zero values remain stable for deterministic test clocks.

Every profile report requires:

- `measurementEnvironment.status`: `stable` or `unstable`.
- `baselineP95ToP50BasisPoints`: the ratio, or null when a positive tail has a zero median.
- `maximumBaselineP95ToP50BasisPoints`: the fixed 20,000 basis-point boundary.
- `measurementEnvironment.failureReasons`: `baseline_p95_tail_inflation_exceeded` exactly when the assessment is unstable.
- `acceptanceStatus`: passes only when the existing budget and correctness decision passes and the measurement environment is stable.
- Aggregate `failureReasons`: adds `measurement_environment_unstable` without removing simultaneous budget or correctness reasons.

The baseline arm is the environmental reference because it disables only stage recording. The candidate distribution cannot determine environmental stability, so a real candidate tail regression remains independently visible as `p95_regression_exceeded`.

The benchmark protocol declares one complete observation with no automatic retry. An unstable report exits unsuccessfully and is ineligible for readiness. A later manual run is a new report; it does not reinterpret the failed observation, waive a budget, filter a tail sample, or create an exception path.

## Privacy and failure meaning

The assessment uses only aggregate baseline durations already present in the report. It adds no prompt, output, repository path, credential, provider response, or host process details.

`baseline_p95_tail_inflation_exceeded` means the baseline distribution is too unstable for the paired p95 comparison to support acceptance; it does not identify the host process responsible. `measurement_environment_unstable` means the profile cannot be accepted even when every numerical budget passes. Both states fail closed and do not claim that a product regression was absent.

## Consequences

The independent verifier recomputes the assessment, budget status, acceptance status, failure reasons, protocol digest, and report identity. Tampering with an environment assessment or dropping a simultaneous regression reason invalidates the report.

The two-times boundary is an evidence protocol constant, not a performance target. Changing it requires another reviewed protocol decision and regenerated source-bound evidence. The absolute prompt, Stop, p99, external-ceiling, correctness, and 10-percent-or-25-millisecond relative gates remain unchanged.

## References

- [ADR-0335](0335-record-and-verify-bounded-execution-stage-evidence.md)
- [ADR-0339](0339-calibrate-short-profile-performance-measurement-floor.md)
- [Execution stage observation and performance](../../../specifications/execution/stage-observation-and-performance.md)
- [Foundation execution performance evidence](../../../evidence/foundation/execution-performance-v1.md)
