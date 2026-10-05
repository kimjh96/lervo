# Readiness and failure meaning

The optional `supervision` component in the owner-only Node health snapshot uses `pending`, `ready`, `dormant`, `attention`, `disabled`, and `unavailable`. A configured service starts pending. Runtime health does not prove accepted task completion or delivered user results.

[Health observations and failure handling](readiness-and-failure/health-observations.md) defines cycle states, recovery, aggregate health, startup grace, privacy, and persistence failures, including the behavior required by [bound-workstream supervision](../../../../../../decisions/execution/orchestration/governed-work/workstream-concurrency/0423-parallel-bound-workstreams.md).

## Service diagnostics and recovery evidence

[Diagnostic and recovery-evidence behavior](readiness-and-failure/service-diagnostics.md) defines the shared logger, evidence-read callback failures, formatting limits, and diagnostic privacy boundary. The [local supervision command](local-command.md) shares this service composition.

## Validation boundaries

[Validation scope](readiness-and-failure/validation.md) records test coverage and the limits of supplied test definitions. [Bound-workstream selection and evidence](readiness-and-failure/bound-workstream-selection.md) defines snapshot verification and the limits of local test evidence.
