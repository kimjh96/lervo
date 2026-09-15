# Operating mandate and admission

## Mandate

A reviewed mandate binds its ID, version, content hash, appointing authority, accountable agent, project and team allowlist, action kinds, role-authoring scope, capability ceiling, paths, providers, hiring capacity, concurrency, per-attempt and aggregate budgets, retry limits, expiry, and revocation coordinate. It excludes credentials. Missing observations indicate unavailable capacity, not free capacity. Existing resource policy controls admission.

Version 3 also supports an [exact reviewed goal scope](work-scope.md) within a long-lived workstream. Historical terminal assignments and earlier resource history remain canonical and cannot serve as results for the new goal.

## Admission workflow

The owner authors an exact plan for every hire, role revision, assignment addition, handoff, or reassignment. A pure evaluator checks the plan against the mandate and current snapshots. The executor rechecks it before commit. Actions within the mandate require no new human approval. Out-of-mandate proposals become bounded decisions. A model proposal grants no authority.

Supported action kinds are `allocate_existing`, `execute_as_owner`, `hire_worker`, `revise_responsibility`, `request_team_support`, `dispatch`, `inspect_uncertain_effect`, `retry_attempt`, `request_rework`, `escalate`, and `publish_result`. Each must map to an existing effect or a versioned extension; admission rejects unsupported mappings.

## Responsibility artifacts

A responsibility artifact requires a task purpose, deliverables, acceptance criteria, decision latitude, expected paths, required capabilities and verification, reviewer, handoff recipients, and finite start, progress, and completion deadlines. The mandate bounds deadline selection from above; the native owner's completion window is floored at ten minutes, or the mandate's maximum deadline when shorter, because a worker turn needs a full bounded lease plus admission latency, and a shorter owner proposal is raised to that floor. Rescheduling records a new decision; hints cannot silently postpone deadlines.

## Review compatibility

Current topology v2 requires reviewer and approval coordinates and excludes automatic review. A separately versioned policy-review mode must bind the mandate, exact plan hash, reviewer policy identity, graph revision, and decision evidence. Manual review must remain available. Never simulate this extension by supplying the owner identity to old CLI reviewer fields. Role authorship cannot create operating-system or external-service permissions.
