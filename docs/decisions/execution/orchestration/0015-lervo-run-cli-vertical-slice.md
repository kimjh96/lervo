# ADR-0015: One-file `lervo run` CLI vertical slice

Status: `accepted`
Decision date: 2026-08-19

## Context

The managed coordinator, project storage, and Codex/Claude adapters worked independently but had no single user entrypoint. Reimplementing their internal steps in the CLI would create a second gate and cleanup path. Project-policy and verification-command contracts were not yet available, so the exposed scope must remain narrow.

## Decision

### Command and scope

```text
lervo run --provider <codex|claude> --path <relative-path> [--skill <skill-id> ...] [--root <path>] [--risk <level>] [--json] <request>
```

- Require provider, one repository-relative path, and a non-empty request. Normalize the path before opening storage or a provider.
- Execute exactly one-file `managed_write`. Do not expose multiple paths, pending human approval, read-only selection, or provider-specific extra permissions.
- Repeated `--skill` names IDs for ADR-0016 discovery and lock only; it does not claim invocation or use.
- Until project-policy schema exists, use a fixed `developer` role requiring root `AGENTS.md` E3. Allow file read/write and limited local shell; deny network, external messaging, deployment, and general data mutation. Use `machine` presentation and no writing policy. Do not present this built-in role as user policy.

### Application service and resources

`run-command` owns argument/output handling; provider-neutral `managed-run` owns composition; `main` only routes commands. The application service:

1. Opens project storage and reads validated manifest and document registry.
2. Resolves requested skills, writes the lock, and binds selections to the fixed role.
3. Connects the selected adapter to the same artifact-store read port.
4. Creates run/session/event/context IDs and the role-policy digest, then executes `ManagedProviderRunCoordinator`.
5. Runs the named project verification suites against the resulting repository revision.
6. Sends the CAS result to the writing publication gate. Production composition evaluates semantic checks through a separate read-only session of the selected local provider and reads source from the same store only when a permit exists.
7. Closes project storage on success or failure before returning.

If execution and close both fail, expose `cleanup_failed` while retaining both causes only in a local `AggregateError`. Fixtures verify adapter and storage closure after provider-start failure. Narrow dependency ports for storage, adapter, and IDs keep CLI tests independent of real provider processes.

### Output and evidence

The initial slice printed provider, run ID, verified changed path, provider result, and two `not_run` verification states. ADR-0025 later added writing evaluation and publication permits; ADR-0032 made one or more named project verification suites mandatory. Current CLI displays provider source only under a permit; otherwise it retains the change, hides content, and exits 1. Passing project and writing verification is not E4.

JSON includes artifact coordinates and publication decision; blocked `content` is `null`. Events retain request digest and artifact ID, never raw request or result. Add no event type or field. Direct provider work remains `unmanaged`.

## Consequences

- Users can run the same one-file managed workflow with Codex or Claude in an initialized repository.
- CLI reuses coordinator context, permit, snapshot, result-storage, and cleanup rules.
- Project verification must pass; missing or failed writing verification is never presented as publication success.
- End-to-end fixtures cover `AGENTS.md` E3, one `file.changed`, CAS result, local semantic evaluation, source minimization, and cleanup.
