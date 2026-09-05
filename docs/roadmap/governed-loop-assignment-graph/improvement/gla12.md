# GLA12: Exact repeated-failure observation

The second production local metric is `repeated_failure`. Every valid canonical verification completion in the inclusive window contributes one denominator unit. A failed completion enters the numerator only if its exact `suiteHash` and ordered `nonPassedCommandIds` signature already occurred in that window. This establishes coordinate recurrence, not a shared defect, root cause, causal improvement, semantic correctness, or model learning.

Completion normalization, verification-success projection, repeated-failure projection, bounded event scanning, receipt binding, storage lifetime, and CLI composition remain separate responsibilities. The adapter descriptor is versioned; one snapshot supplies both metrics. Command identifiers are not copied into observation or effect artifacts. The existing version-1 lower-is-favorable comparison policy remains authoritative.

## Acceptance

Focused tests must cover:

- Exact first-versus-later recurrence.
- Suite and ordered command-signature separation.
- Passed and cancelled exclusion; valid zero observation.
- Contradictory coordinate rejection.
- Empty and bounded-source abstention.
- Shared conformance for both metrics and exact re-verification.
- A full two-metric baseline-to-treatment CLI host-injection journey.

Quality, type, package-boundary, build, full tests, documentation and knowledge lifecycle, foundation checks, and task-base release completion must pass. Release intent is required only when an embedding product adds this private adapter to a published artifact closure.
