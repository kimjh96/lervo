# `work.causality.recorded`

Retains opaque work, run-relationship, attempt, workstream, assignment, and agent coordinates. The payload schema discriminates root, retry, and other child shapes.

Before provider startup, it enforces one event per run, one root per work, existing same-work parents, exact retry ordinals, acyclic ancestry, and idempotent recovery.

Deliberation uses one control root with role and publication-evaluation children.
