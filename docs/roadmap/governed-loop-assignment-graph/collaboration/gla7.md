# GLA7: Exact assignment routines and manual triggers

Content-bound assignment templates support one explicit local manual trigger. The pure controller validates at most 32 acyclic nodes, exact role and optional capability bindings, and `skip_if_active`, `coalesce_if_active`, or bounded-enqueue admission. It derives deterministic invocation and assignment IDs and exposes an exact plan without template, acceptance, approval, or path prose.

Apply rechecks under a transient routine lock and delegates each node to existing workforce assignment creation. Routine provenance is additive assignment state and `assignment.created` metadata, not a second task or scheduler store.

Multi-node apply is convergent: committed nodes remain canonical, deterministic replay is idempotent, and a fresh plan resumes only missing nodes. Materialization creates no lease and starts no provider.

## Acceptance

Focused tests must cover:

- Deterministic DAG expansion, role and capability drift rejection, and stale-plan blocking.
- Idempotent creation, partial resume, and capability-bound claim.
- Skip/coalesce/enqueue distinctions, concurrency and capacity bounds, and privacy allowlisting.
- No arbitrary prompt execution or unattended trigger.

Quality, type, package-boundary, build, full tests, documentation and knowledge lifecycle, foundation checks, and task-base release completion must pass with reviewed minor release intent.
