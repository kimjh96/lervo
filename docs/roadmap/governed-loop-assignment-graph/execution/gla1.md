# GLA1: First vertical slice

The first slice provides:

- A graph projection over current-workstream assignments: roots, parallel ready nodes, joins, exact approval-requirement digests, leases, and attempt counts.
- Cycle, self-dependency, duplicate, and cross-workstream dependency findings.
- One governed decision for claim, start, retry, approval wait, dependency wait, cancellation propagation, block, escalation, or completion.
- At most 16 attempts per assignment and 32 parallel assignments. Active attempts consume capacity before another claim, start, or retry is recommended.
- Exact provider, resource-scope, and accounting-descriptor token admission thresholds. No addition across providers, scopes, or descriptors; no advance-reservation claim.
- Complete, partial, unavailable, and invalid resource handling, never inferred zero.
- Assignment- and agent-bound causal root and retry records.
- Fail-closed attempt-to-assignment and provider-resource attribution checks.
- Manual `lervo loop status` and `lervo loop run` routes over the same public application contract.
- Provider-run success finalization only after verification and writing publication pass.

The controller retains no mutable loop state; restart and resume replay canonical state. A completed managed run with an unobservable assignment-finalization outcome becomes `completion_reconciliation_required` and is not automatically rerun.

## Acceptance

Focused tests must cover parallel roots and a join, exact retry ancestry, approval blocking, cancellation propagation, resource exhaustion and missing-telemetry behavior, managed-run causal binding, CLI port composition, and no new canonical store.

Quality, type, package-boundary, build, relevant full tests, documentation lifecycle, and task-base release-completion checks must pass with reviewed minor release intent.
