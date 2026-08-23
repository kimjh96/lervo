# ADR-0002: Safe Local Project Initialization

Status: `accepted`
Decision date: 2026-08-18

## Context

`lervo init` adds Lervo identity and local state paths to an existing repository. Overwriting user documents, or allowing dry-run and apply to decide differently, would make later evidence untrustworthy. Creating configuration before its contract exists would also make temporary formats appear public.

## Decision

### Inspect and apply the same plan

- Dry-run and apply use the same `InitPlan` structure and creation function.
- Classify every operation as `create`, `unchanged`, or `conflict`.
- Dry-run shows the complete content of every new file.
- Immediately before apply, recheck every target's existence and existing-file hash. If anything changed after planning, require a new plan and apply nothing.
- For a new `.lervo`, write into a temporary tree in the same repository, then publish by atomic rename. Remove the temporary tree after an intermediate failure so partial initialization is never visible.
- If `.lervo` exists, track only entries created by the current apply and roll them back in reverse order after an intermediate failure.
- Restrict writes to `.lervo` and descendants, including for externally constructed plans.

### Ownership in the first slice

- Create or read `.lervo/project.yaml` and the then-current `.lervo/documents.yaml` only when they satisfy the current JSON Schema.
- Write the `state/` rule to `.lervo/.gitignore` only when creating that file; never modify an existing file.
- Prepare `.lervo/generated/`, `.lervo/state/`, and `.lervo/knowledge/`.
- Do not create `policy.yaml` or `skills.lock` before independent contracts exist.
- Do not read or modify repository-root `README.md`, `AGENTS.md`, `CLAUDE.md`, or other user files.

[ADR-0016](../execution/orchestration/0016-local-skill-resolution-and-lock.md) defines `skills.lock`. Init still does not create an empty lock because the first skill resolution owns this provider-, role-, and runtime-specific record.

[ADR-0017](../knowledge/documents/0017-sharded-document-manifests.md) changes new initialization to an empty `.lervo/documents/` directory with per-document sidecars. A legacy registry is read only when it is the sole format and is never migrated automatically. [ADR-0024](../execution/providers/0024-provider-neutral-project-verification.md) adds an empty `.lervo/verifications/` directory without default commands or results.

### Existing state and conflicts

- Preserve the ID, name, creation time, and data policy from a valid existing project manifest.
- Never repair or overwrite existing project or document YAML that fails the current schema.
- Do not follow symbolic links in managed paths.
- Any conflict blocks the entire plan; never create only a subset.
- Generate a new project ID once during planning and apply that exact value.

## Consequences

- Repeated initialization preserves project identity and user files.
- Apply uses exactly the plan and new-file content shown by dry-run.
- Failed initialization of a new repository leaves no partial `.lervo` tree and can be replanned.
- Configuration formats remain unfixed until ADRs and schemas define them.
- Init records no execution event because no SQLite event store exists yet; the next M1 vertical slice connects it.
