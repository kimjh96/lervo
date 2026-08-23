# ADR-0056: Search evaluation bundles and sample sufficiency

Status: `accepted`
Decision date: 2026-08-20

## Context

Evaluating every case together obscures represented role/task, while duplicate or superseded cases inflate counts. Too few samples should not block baseline observation, but must block claims that a candidate comparison is ready.

## Decision

- `SearchEvaluationBundle` content-binds project, role, task type, minimum active samples, active case IDs, and replacement relations.
- Allow one bundle per project/role/task, at most 32 bundles, 64 active cases, and 192 replacement edges.
- Store one `.lervo/search-evaluations/<bundleId>.bundle.yaml`; never overwrite automatically or append configuration history.
- Bundles store no query and emit no Hub/event data.
- A superseded case cannot remain active. Each replacement has one successor, is acyclic, terminates at an active case, and references valid same-project cases.
- Reject active cases sharing a query digest as duplicate samples; do not infer semantic duplicates beyond exact digest.
- Derive `SearchEvaluationCoverage` from bundle and cases. Minimum met gives `sampleState=sufficient` and `comparisonReadiness=ready`; otherwise `insufficient`/`insufficient_sample`.
- Bundle report shows deficit and exits 1 when insufficient. Bundle evaluation still runs exactly active cases under lexical baseline, but exits 1 and creates no comparison artifact when insufficient.
- `ready` means only the declared count is met—not statistical representativeness, quality, context evidence, verification, or embedding adoption. Keep embedding decision undetermined.

Failures distinguish invalid bundle/coverage, unsafe or duplicate-scope layout, count overflow, read/write failure, and normal `insufficient_sample`. Never select a subset after limits/conflicts.

## Consequences

Baseline measurement remains available while candidate comparison requires explicit role/task sample coverage.
