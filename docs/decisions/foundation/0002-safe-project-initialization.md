# ADR-0002: Safe Local Project Initialization

Status: `accepted`
Decision date: 2026-08-18

## Context

`lervo init` adds Lervo project identity and local state paths to an existing repository. If it overwrites user documents, or if dry-run and apply make different decisions, later execution evidence cannot be trusted. Conversely, creating configuration files before their contracts exist can make temporary formats appear to be public specifications.

## Decision

### Inspect and apply the same plan

- Dry-run and apply use the same `InitPlan` structure and creation function.
- Every operation is `create`, `unchanged`, or `conflict`.
- Dry-run displays the complete content of each new file.
- Immediately before apply, recheck existence and the existing-file hash of every target.
- If a target changed after planning, require a new plan and do not apply.
- For a new `.lervo`, write all content to a temporary tree in the same repository and publish it with an atomic rename. Remove the temporary tree if an intermediate write fails so partial initialization is never visible.
- When `.lervo` already exists, track only entries created by the current apply and roll them back in reverse order after an intermediate failure.
- Writable paths are restricted to `.lervo` and its descendants. Even an externally constructed plan object cannot write other repository files.

### Ownership in the first slice

- `.lervo/project.yaml` and the then-current `.lervo/documents.yaml` are created or read only when they pass the current JSON Schema.
- `.lervo/.gitignore` writes the `state/` rule only for a new file. Existing files are not modified.
- Prepare `.lervo/generated/`, `.lervo/state/`, and `.lervo/knowledge/`.
- Do not create `policy.yaml` or `skills.lock` before independent contracts exist for them.

Follow-up: [ADR-0016](../execution/orchestration/0016-local-skill-resolution-and-lock.md) adds the `skills.lock` contract. Because the lock records provider-, role-, and runtime-specific resolution, init still does not create an empty lock; the first skill resolution owns that record.

Follow-up: [ADR-0017](../knowledge/documents/0017-sharded-document-manifests.md) changes new initialization to an empty `.lervo/documents/` directory with per-document sidecar manifests. The legacy single registry is not migrated automatically and is read only when it is the sole format. [ADR-0024](../execution/providers/0024-provider-neutral-project-verification.md) adds an empty `.lervo/verifications/` directory for suite-specific configuration without creating default commands or results.

- Do not read or modify repository-root `README.md`, `AGENTS.md`, `CLAUDE.md`, or other user files.

### Existing state and conflicts

- Preserve the project ID, name, creation time, and data policy from a valid existing project manifest.
- Do not repair or overwrite existing project/document YAML that fails the current schema.
- Do not follow symbolic links in managed paths.
- Any conflict blocks the whole plan so only a subset of directories or files cannot be created.
- Generate a new project ID once during planning; apply uses that exact value.

## Consequences

- Repeated initialization does not change project identity or user files.
- Apply uses the exact plan and new-file content shown in dry-run.
- A failure during new-repository initialization leaves no partial `.lervo` tree and can be replanned.
- Configuration formats without contracts remain unfixed until later ADRs and schemas decide them.
- Because no SQLite event store exists yet, init itself records no execution event. The next M1 vertical slice connects the local event store.
