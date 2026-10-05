# Managed deliberation budget and runner behavior

This specification records behavior visible in `apps/cli/src/managed-deliberation-budget.ts` and `apps/cli/src/managed-deliberation-runner.ts`. It supplements [ADR-0418](../decisions/execution/applications/0418-retain-deliberation-as-bounded-decision-workflow.md) and identifies an accounting terminology difference from [ADR-0460](../decisions/coordination/deliberation/0460-trigger-tiered-deliberation-at-decision-points.md). Source inspection does not establish passing tests or installed acceptance.

- [Usage accounting and budget](managed-deliberation-budget-and-runner/accounting-and-budget.md): accepted observations, scope, admission, and failures.
- [Runner boundaries](managed-deliberation-budget-and-runner/runner.md): snapshots, timing, configuration, causality, and result validation.
- [Semantic evaluation recovery](managed-deliberation-budget-and-runner/semantic-evaluation.md): retry conditions and evaluation boundaries.
