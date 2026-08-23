# ADR-0056: Search evaluation bundles and sample sufficiency

Status: `accepted`
Decision date: 2026-08-20

## Context

Evaluating all cases together obscures represented roles and tasks, while duplicate or superseded cases inflate counts. Small samples may support baseline observation but must not imply that candidate comparison is ready.

## Decision

- `SearchEvaluationBundle` content-binds project, role, task type, minimum active samples, active case IDs, and replacement relations.
- Allow one bundle per project/role/task, at most 32 bundles, 64 active cases, and 192 replacement edges.
- Store each bundle at `.lervo/search-evaluations/<bundleId>.bundle.yaml`. Never overwrite it automatically or append configuration history.
- Bundles contain no query and emit no Hub or event data.
- A superseded case cannot remain active. Each replacement has one successor, is acyclic, ends at an active case, and references valid cases from the same project.
- Reject active cases with the same query digest as duplicate samples. Do not infer semantic duplication beyond exact digest equality.
- Derive `SearchEvaluationCoverage` from the bundle and cases. Meeting the minimum yields `sampleState=sufficient` and `comparisonReadiness=ready`; otherwise use `insufficient` and `insufficient_sample`.
- Bundle reports show the deficit and exit 1 when insufficient. Bundle evaluation still runs exactly the active cases against the lexical baseline, but exits 1 and creates no comparison artifact when insufficient.
- `ready` means only that the declared count is met. It does not establish statistical representativeness, quality, context evidence, verification, or embedding adoption. Keep the embedding decision undetermined.

Distinguish invalid bundles or coverage, unsafe or duplicate-scope layouts, count overflow, read or write failures, and normal `insufficient_sample`. Never select a subset after detecting limits or conflicts.

## Consequences

Baseline measurement remains available, while candidate comparison requires explicit sample coverage for the declared role and task.
