# ADR-0357: Fail closed on unstable performance measurement environments

- Status: `accepted`
- Decision date: 2026-09-04

## Context

The foundation performance protocol alternates baseline and candidate arms, but the declared local
environment does not control power mode, operating-system scheduling, or competing workloads. The
existing report exposes each distribution but cannot distinguish an unstable baseline from a
candidate-only regression in its machine-readable decision.

A source-equivalent 200-pair diagnostic observation exposed this gap. The large warm prompt
baseline moved from a 251.095 millisecond p50 to a 505.739 millisecond p95, while the candidate
moved from a 257.063 millisecond p50 to a 564.768 millisecond p95. The resulting 59.029 millisecond
candidate regression exceeded the unchanged 50.5739 millisecond allowance. Another complete run
under the same source later produced a 7.695 millisecond regression, but selecting the later result
would hide the first observation rather than explain it.

Repository history provides a separate calibration check. Stable deterministic baseline profiles
normally keep p95 close to p50, while five previously retained host-contended profile observations
exceeded three times their baseline p50. A conservative two-times boundary detects sustained
baseline tail inflation without judging candidate instrumentation from its own distribution.

## Decision

`@lervo/execution-performance` owns one pure measurement-environment assessment in addition to its
unchanged budget policy. A profile is `unstable` when baseline p95 exceeds two times baseline p50.
If baseline p50 is zero and p95 is positive, the ratio is unavailable and the profile is also
unstable. Equal zero values remain stable for deterministic test clocks.

Every profile report requires these fields:

- `measurementEnvironment.status` is `stable` or `unstable`.
- `baselineP95ToP50BasisPoints` contains the ratio or null when a positive tail has a zero median.
- `maximumBaselineP95ToP50BasisPoints` is the fixed 20,000 basis-point boundary.
- `measurementEnvironment.failureReasons` contains
  `baseline_p95_tail_inflation_exceeded` exactly when the assessment is unstable.
- `acceptanceStatus` passes only when the existing budget and correctness decision passes and the
  measurement environment is stable.
- The aggregate `failureReasons` adds `measurement_environment_unstable` without removing any
  simultaneous budget or correctness reason.

The baseline arm is the environmental reference because it disables only stage recording. The
candidate distribution cannot make the environment stable or unstable, so a real candidate tail
regression remains independently visible as `p95_regression_exceeded`.

The benchmark protocol declares a single complete observation with no automatic retry. An unstable
report exits unsuccessfully and is ineligible for readiness. A later manual run is a new report; it
does not reinterpret the failed observation, waive a budget, filter a tail sample, or create an
exception path.

## Privacy and failure meaning

The assessment uses only aggregate baseline durations already present in the report. It adds no
prompt, output, repository path, credential, provider response, or host process details.

`baseline_p95_tail_inflation_exceeded` means the baseline distribution is too unstable for the
paired p95 comparison to support acceptance. It does not prove which host process caused the tail.
`measurement_environment_unstable` means the profile cannot be accepted even if every numerical
budget passes. Both states fail closed and do not claim a product regression was absent.

## Consequences

The independent verifier recomputes the assessment, budget status, acceptance status, failure
reasons, protocol digest, and report identity. Tampering with an environment assessment or dropping
a simultaneous regression reason invalidates the report.

The two-times boundary is an evidence protocol constant, not a performance target. Changing it
requires another reviewed protocol decision and regenerated source-bound evidence. The absolute
prompt, Stop, p99, external-ceiling, correctness, and 10-percent-or-25-millisecond relative gates
remain unchanged.

## References

- [ADR-0335](0335-record-and-verify-bounded-execution-stage-evidence.md)
- [ADR-0339](0339-calibrate-short-profile-performance-measurement-floor.md)
- [Execution stage observation and performance](../../../specifications/execution/stage-observation-and-performance.md)
- [Foundation execution performance evidence](../../../evidence/foundation/execution-performance-v1.md)
